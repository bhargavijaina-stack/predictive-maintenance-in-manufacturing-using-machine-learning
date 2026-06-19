import os
import threading
import datetime
from functools import wraps
import numpy as np
import pandas as pd
import tensorflow as tf
from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from sklearn.preprocessing import LabelEncoder, MinMaxScaler
from tensorflow.keras.models import Sequential, load_model
from tensorflow.keras.layers import Conv2D, MaxPooling2D, Flatten, Dense

app = Flask(__name__)
app.secret_key = 'predictive_maintenance_secret_key_secure_123'

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get('logged_in'):
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function


DATA_PATH = os.path.join('Dataset', 'predictive_maintenance.csv')
STREAM_PATH = os.path.join('Dataset', 'testData.csv')
MODEL_WEIGHTS = os.path.join('model', 'cnn_weights.hdf5')
FEATURE_COLUMNS = [
    'Product_ID',
    'Type',
    'Air_temperature_[K]',
    'Process_temperature_[K]',
    'Rotational_speed_[rpm]',
    'Torque_[Nm]',
    'Tool_wear_[min]',
]
LIVE_UPDATE_INTERVAL_MS = 4000


def load_dataset(path):
    return pd.read_csv(path)


def build_encoders(df):
    product_encoder = LabelEncoder()
    product_encoder.fit(df['Product_ID'].astype(str))

    type_encoder = LabelEncoder()
    type_encoder.fit(df['Type'].astype(str))

    failure_encoder = LabelEncoder()
    failure_encoder.fit(df['Failure_Type'].astype(str))

    return product_encoder, type_encoder, failure_encoder


def build_scaler(df, product_encoder, type_encoder):
    encoded = df.copy()
    encoded['Product_ID'] = product_encoder.transform(encoded['Product_ID'].astype(str))
    encoded['Type'] = type_encoder.transform(encoded['Type'].astype(str))
    encoded = encoded.drop(['UDI', 'Target', 'Failure_Type'], axis=1)
    scaler = MinMaxScaler(feature_range=(0, 1))
    scaler.fit(encoded.values)
    return scaler


def build_cnn_model(input_count, class_count):
    model = Sequential()
    model.add(Conv2D(32, (1, 1), activation='relu', input_shape=(input_count, 1, 1)))
    model.add(MaxPooling2D(pool_size=(1, 1)))
    model.add(Conv2D(16, (1, 1), activation='relu'))
    model.add(MaxPooling2D(pool_size=(1, 1)))
    model.add(Flatten())
    model.add(Dense(256, activation='relu'))
    model.add(Dense(class_count, activation='softmax'))
    model.compile(optimizer='adam', loss='categorical_crossentropy', metrics=['accuracy'])
    return model


def get_machine_description(type_label):
    mapping = {
        'H': 'Heavy-duty machine',
        'M': 'Medium-duty machine',
        'L': 'Light-duty machine',
    }
    return mapping.get(type_label, 'Standard machine')


def build_failure_stats(df):
    keys = [
        'Air_temperature_[K]',
        'Process_temperature_[K]',
        'Rotational_speed_[rpm]',
        'Torque_[Nm]',
        'Tool_wear_[min]',
    ]
    stats = {}
    for label in sorted(df['Failure_Type'].unique()):
        subset = df[df['Failure_Type'] == label]
        mean = subset[keys].mean()
        std = subset[keys].std().replace(0, 1)
        stats[label] = {
            'mean': mean.to_dict(),
            'std': std.to_dict(),
        }
    return stats


def explain_prediction(values, prediction_label):
    feature_names = {
        'Air_temperature_[K]': 'Air temperature',
        'Process_temperature_[K]': 'Process temperature',
        'Rotational_speed_[rpm]': 'Rotational speed',
        'Torque_[Nm]': 'Torque',
        'Tool_wear_[min]': 'Tool wear',
    }
    metric_keys = list(feature_names.keys())
    current = {
        metric_keys[0]: float(values[2]),
        metric_keys[1]: float(values[3]),
        metric_keys[2]: float(values[4]),
        metric_keys[3]: float(values[5]),
        metric_keys[4]: float(values[6]),
    }
    if prediction_label not in failure_stats:
        return 'No explanation available.'

    stats = failure_stats[prediction_label]
    diffs = []
    for key, value in current.items():
        mean = stats['mean'][key]
        std = stats['std'][key] or 1.0
        z_score = (value - mean) / std
        direction = 'higher' if z_score > 0 else 'lower'
        diffs.append({
            'key': key,
            'value': value,
            'mean': mean,
            'z_score': abs(z_score),
            'direction': direction,
        })

    diffs.sort(key=lambda item: item['z_score'], reverse=True)
    top = diffs[:3]
    reasons = []
    for item in top:
        short_name = feature_names[item['key']]
        reasons.append(
            f"{short_name} ({item['value']:.1f}) is {item['direction']} than typical ({item['mean']:.1f})"
        )

    if not reasons:
        return 'Input values are close to the typical range for this failure type.'

    return ' and '.join(reasons[:2]) + '.'


def preprocess_input(values, product_encoder, type_encoder, scaler):
    product_id, type_label, air_temp, proc_temp, rpm, torque, tool_wear = values
    if product_id not in product_encoder.classes_:
        raise ValueError(
            'Unknown Product ID. Please enter a Product_ID that exists in the training dataset.'
        )
    if type_label not in type_encoder.classes_:
        raise ValueError('Type must be one of: {}.'.format(', '.join(type_encoder.classes_)))

    encoded = np.zeros((1, len(FEATURE_COLUMNS)), dtype=float)
    encoded[0, 0] = product_encoder.transform([product_id])[0]
    encoded[0, 1] = type_encoder.transform([type_label])[0]
    encoded[0, 2] = float(air_temp)
    encoded[0, 3] = float(proc_temp)
    encoded[0, 4] = float(rpm)
    encoded[0, 5] = float(torque)
    encoded[0, 6] = float(tool_wear)
    scaled = scaler.transform(encoded)
    return scaled.reshape((scaled.shape[0], scaled.shape[1], 1, 1))


def format_prediction(prediction):
    predicted_index = int(np.argmax(prediction, axis=1)[0])
    probabilities = [
        {'label': failure_labels[i], 'probability': float(prediction[0, i])}
        for i in range(len(failure_labels))
    ]
    probabilities.sort(key=lambda item: item['probability'], reverse=True)
    return failure_labels[predicted_index], probabilities


def build_stream_item(row, prediction_label, probabilities):
    values = [
        str(row['Product_ID']),
        str(row['Type']),
        str(row['Air_temperature_[K]']),
        str(row['Process_temperature_[K]']),
        str(row['Rotational_speed_[rpm]']),
        str(row['Torque_[Nm]']),
        str(row['Tool_wear_[min]']),
    ]
    explanation = explain_prediction(values, prediction_label)
    return {
        'timestamp': datetime.datetime.now().strftime('%H:%M:%S'),
        'Product_ID': str(row['Product_ID']),
        'Type': str(row['Type']),
        'machine_description': get_machine_description(str(row['Type'])),
        'Air_temperature_[K]': float(row['Air_temperature_[K]']),
        'Process_temperature_[K]': float(row['Process_temperature_[K]']),
        'Rotational_speed_[rpm]': float(row['Rotational_speed_[rpm]']),
        'Torque_[Nm]': float(row['Torque_[Nm]']),
        'Tool_wear_[min]': float(row['Tool_wear_[min]']),
        'predicted_failure': prediction_label,
        'prediction_score': max(item['probability'] for item in probabilities),
        'probabilities': probabilities,
        'xai': explanation,
    }


# Load data, encoders, scaler, and model once at startup.
raw_data = load_dataset(DATA_PATH)
product_encoder, type_encoder, failure_encoder = build_encoders(raw_data)
scaler = build_scaler(raw_data, product_encoder, type_encoder)

stream_data = load_dataset(STREAM_PATH)
stream_index = 0
stream_lock = threading.Lock()
prediction_lock = threading.Lock()

if not os.path.exists(MODEL_WEIGHTS):
    raise FileNotFoundError('Model weights not found: {}'.format(MODEL_WEIGHTS))

# Load the exact saved model configuration and weights from the checkpoint file.
cnn_model = load_model(MODEL_WEIGHTS, compile=False)

failure_labels = failure_encoder.inverse_transform(np.arange(len(failure_encoder.classes_))).tolist()
failure_stats = build_failure_stats(raw_data)
example_product_ids = sorted(raw_data['Product_ID'].astype(str).unique())[:12]


@app.route('/', methods=['GET'])
def index():
    is_logged_in = session.get('logged_in', False)
    return render_template(
        'index.html',
        logged_in=is_logged_in,
        product_types=sorted(type_encoder.classes_.tolist()),
        sample_product_ids=example_product_ids,
        failure_labels=failure_labels,
        live_interval=LIVE_UPDATE_INTERVAL_MS,
    )


@app.route('/login', methods=['GET', 'POST'])
def login():
    if session.get('logged_in'):
        return redirect(url_for('dashboard'))
    
    error = None
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        if username == 'admin' and password == 'admin':
            session['logged_in'] = True
            return redirect(url_for('dashboard'))
        else:
            error = 'Invalid username or password'
            
    return render_template('login.html', error=error)


@app.route('/logout')
def logout():
    session.pop('logged_in', None)
    return redirect(url_for('index'))


@app.route('/dashboard')
@login_required
def dashboard():
    return render_template(
        'dashboard.html',
        product_types=sorted(type_encoder.classes_.tolist()),
        sample_product_ids=example_product_ids,
        failure_labels=failure_labels,
        live_interval=LIVE_UPDATE_INTERVAL_MS,
    )


@app.route('/sample-data', methods=['GET'])
@login_required
def sample_data():
    try:
        # Pick a random row from raw_data
        row = raw_data.sample(n=1).iloc[0]
        return jsonify({
            'success': True,
            'product_id': str(row['Product_ID']),
            'type': str(row['Type']),
            'air_temp': float(row['Air_temperature_[K]']),
            'proc_temp': float(row['Process_temperature_[K]']),
            'rpm': int(row['Rotational_speed_[rpm]']),
            'torque': float(row['Torque_[Nm]']),
            'tool_wear': int(row['Tool_wear_[min]'])
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@app.route('/predict', methods=['POST'])
@login_required
def predict():
    try:
        values = [
            request.form['product_id'].strip(),
            request.form['type'].strip(),
            request.form['air_temp'].strip(),
            request.form['proc_temp'].strip(),
            request.form['rpm'].strip(),
            request.form['torque'].strip(),
            request.form['tool_wear'].strip(),
        ]
        input_data = preprocess_input(values, product_encoder, type_encoder, scaler)
        with prediction_lock:
            prediction = cnn_model.predict(input_data, verbose=0)
        label, probabilities = format_prediction(prediction)
        xai = explain_prediction(values, label)
        return jsonify({
            'success': True,
            'predicted_failure': label,
            'probabilities': probabilities,
            'xai': xai,
        })
    except ValueError as exc:
        return jsonify({'success': False, 'error': str(exc)})
    except Exception as exc:
        return jsonify({'success': False, 'error': 'Prediction failed: {}'.format(exc)})


@app.route('/live-data')
@login_required
def live_data():
    global stream_index
    with stream_lock:
        if stream_index >= len(stream_data):
            stream_index = 0
        row = stream_data.iloc[stream_index]
        stream_index += 1

    try:
        values = [
            str(row['Product_ID']),
            str(row['Type']),
            str(row['Air_temperature_[K]']),
            str(row['Process_temperature_[K]']),
            str(row['Rotational_speed_[rpm]']),
            str(row['Torque_[Nm]']),
            str(row['Tool_wear_[min]']),
        ]
        input_data = preprocess_input(values, product_encoder, type_encoder, scaler)
        with prediction_lock:
            prediction = cnn_model.predict(input_data, verbose=0)
        label, probabilities = format_prediction(prediction)

        stream_item = build_stream_item(row, label, probabilities)
        return jsonify({'success': True, 'item': stream_item})
    except Exception as exc:
        return jsonify({'success': False, 'error': 'Live prediction failed: {}'.format(exc)})


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False, use_reloader=False, threaded=False)

