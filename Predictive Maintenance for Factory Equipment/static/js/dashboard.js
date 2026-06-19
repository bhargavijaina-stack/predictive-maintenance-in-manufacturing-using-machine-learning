// Helper functions for dashboard rendering
function renderProbabilityBar(item) {
  const value = Math.round(item.probability * 100);
  return `<div class="probability-row"><span>${item.label}</span><span>${value}%</span></div>`;
}

function renderFeedItem(item) {
  return `
      <div class="row">
        <div>
          <h4>${item.predicted_failure}</h4>
          <small>Machine ${item.Product_ID} • ${item.timestamp}</small>
          <small>Type ${item.Type} — ${item.machine_description}</small>
        </div>
        <div class="status-chip">${Math.round(item.prediction_score * 100)}%</div>
      </div>
      <div class="row" style="gap: 8px; margin-top: 12px;">
        <small>Temp: ${item['Air_temperature_[K]']}K</small>
        <small>Process: ${item['Process_temperature_[K]']}K</small>
        <small>RPM: ${item['Rotational_speed_[rpm]']}</small>
      </div>
      <div class="xai-text"><strong>Reason:</strong> ${item.xai}</div>
      <div class="row" style="flex-direction: column; gap: 6px; margin-top: 12px;">
        ${item.probabilities.slice(0, 3).map(renderProbabilityBar).join('')}
      </div>
  `;
}

// Update UI panel values based on telemetry stream
function updateDashboardMetrics(item) {
  // Update numeric indicators
  const airTemp = document.getElementById('sensor-air-temp');
  const procTemp = document.getElementById('sensor-proc-temp');
  const rpm = document.getElementById('sensor-rpm');
  const torque = document.getElementById('sensor-torque');
  const vibVal = document.getElementById('current-vibration-val');
  const statusPill = document.getElementById('overall-status-pill');

  if (airTemp) airTemp.innerText = `${item['Air_temperature_[K]'].toFixed(1)} K`;
  if (procTemp) procTemp.innerText = `${item['Process_temperature_[K]'].toFixed(1)} K`;
  if (rpm) rpm.innerText = `${item['Rotational_speed_[rpm]'].toFixed(0)} RPM`;
  if (torque) torque.innerText = `${item['Torque_[Nm]'].toFixed(1)} Nm`;

  // Simulate vibration based on whether there's a failure
  let isFailure = item.predicted_failure !== 'No Failure';
  let vibration = isFailure 
    ? (18.0 + Math.random() * 10.0).toFixed(1) 
    : (10.0 + Math.random() * 5.0).toFixed(1);
    
  if (vibVal) vibVal.innerText = `${vibration} mm/s`;

  // Update Status Pill
  if (statusPill) {
    if (isFailure) {
      statusPill.className = 'risk-pill bg-danger-subtle text-danger border border-danger-subtle px-2 py-1';
      statusPill.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Risk Alert`;
    } else {
      statusPill.className = 'risk-pill bg-success-subtle text-success border border-success-subtle px-2 py-1';
      statusPill.innerHTML = `<i class="fa-solid fa-circle-check"></i> Standard`;
    }
  }

  // Update SVG Wave line dynamically for cool micro-animations
  const pathElement = document.getElementById('dynamic-graph-path');
  if (pathElement) {
    const scale = isFailure ? 1.8 : 1.0;
    const y1 = Math.floor((Math.random() * 30 + 35) * scale);
    const y2 = Math.floor((Math.random() * 30 + 20) * scale);
    const y3 = Math.floor((Math.random() * 30 + 40) * scale);
    const y4 = Math.floor((Math.random() * 30 + 15) * scale);
    pathElement.setAttribute('d', `M10,80 C45,${90 - y1} 60,${90 - y2} 85,78 C110,92 140,${90 - y3} 170,76 C200,82 230,${90 - y4} 260,48 C285,54 295,40 300,28`);
  }
}

function updateLiveFeed(item) {
  const feed = document.getElementById('live-feed');
  if (!feed) return;
  const card = document.createElement('div');
  card.className = 'feed-card mb-3';
  card.innerHTML = renderFeedItem(item);
  feed.prepend(card);
  
  // Keep live feed to max 5 items for cleaner layout
  while (feed.children.length > 5) {
    feed.removeChild(feed.lastChild);
  }
}

function showPrediction(result) {
  const target = document.getElementById('prediction-result');
  if (!target) return;
  
  // Reset grid/display style
  target.style.display = 'block';
  
  if (!result.success) {
    target.innerHTML = `<div class="result-card p-3" style="border-left: 4px solid var(--red); background: rgba(255,30,30,0.05);"><strong class="text-danger"><i class="fa-solid fa-triangle-exclamation"></i> Error</strong><p class="m-0 mt-2 small">${result.error}</p></div>`;
    return;
  }
  
  // Clean, beautiful output alignment
  const isFailure = result.predicted_failure !== 'No Failure';
  const headerClass = isFailure ? 'text-danger' : 'text-success';
  const icon = isFailure ? 'fa-triangle-exclamation' : 'fa-circle-check';
  
  target.innerHTML = `
    <div class="result-card p-3 rounded-4 fade-up visible" style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.08);">
      <div class="d-flex justify-content-between align-items-center mb-3">
        <strong class="${headerClass}"><i class="fa-solid ${icon}"></i> Predicted failure:</strong>
        <span class="badge ${isFailure ? 'bg-danger-subtle text-danger' : 'bg-success-subtle text-success'} px-2 py-1">${result.predicted_failure}</span>
      </div>
      
      <div class="mb-3">
        <label class="text-muted small d-block mb-2">Class Confidence Distributions</label>
        <div style="display: grid; gap: 8px;">
          ${result.probabilities
            .slice(0, 4)
            .map((item) => {
              const val = Math.round(item.probability * 100);
              const activeColor = item.label === result.predicted_failure ? (isFailure ? 'bg-danger' : 'bg-success') : 'bg-secondary-subtle';
              return `
                <div class="d-flex align-items-center gap-3">
                  <span class="small text-muted" style="width: 140px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${item.label}</span>
                  <div class="progress flex-grow-1" style="height: 6px; background: rgba(255,255,255,0.05);">
                    <div class="progress-bar ${activeColor}" role="progressbar" style="width: ${val}%;" aria-valuenow="${val}" aria-valuemin="0" aria-valuemax="100"></div>
                  </div>
                  <span class="small fw-semibold" style="width: 38px; text-align: right;">${val}%</span>
                </div>
              `;
            })
            .join('')}
        </div>
      </div>
      <div class="xai-text mt-3 p-3 rounded-3" style="background: rgba(255,255,255,0.03); border-left: 3px solid var(--red);">
        <strong>Explainable Analysis (XAI):</strong> 
        <p class="m-0 mt-1 small">${result.xai || 'Typical operating values detected.'}</p>
      </div>
    </div>
  `;
}

async function fetchLiveData() {
  try {
    const response = await fetch('/live-data');
    const data = await response.json();
    if (data.success) {
      updateLiveFeed(data.item);
      updateDashboardMetrics(data.item);
    }
  } catch (err) {
    console.warn('Live update failed', err);
  }
}

async function submitPrediction(event) {
  if (event) event.preventDefault();
  
  const form = document.getElementById('predict-form');
  const payload = new FormData(form);
  const resultCard = document.getElementById('prediction-result');
  
  if (resultCard) {
    resultCard.innerHTML = `<div class="p-4"><div class="spinner-border text-danger spinner-border-sm mb-2" role="status"></div><span class="d-block text-muted small">Running inference models...</span></div>`;
  }
  
  try {
    const response = await fetch('/predict', {
      method: 'POST',
      body: payload,
    });
    const result = await response.json();
    showPrediction(result);
  } catch (err) {
    showPrediction({ success: false, error: err.message });
  }
}

// NEW: Browse Project Autoload Functionality
async function autoloadSampleData() {
  const triggerBtn = document.getElementById('autoload-trigger');
  const section = document.getElementById('autoload-section');
  
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Autoloading...`;
  }
  
  try {
    const response = await fetch('/sample-data');
    const data = await response.json();
    
    if (data.success) {
      // Trigger flash animation on the parent panel
      if (section) {
        section.classList.remove('autoload-success-flash');
        void section.offsetWidth; // Trigger reflow to restart css animation
        section.classList.add('autoload-success-flash');
      }

      // Populate Form Fields with smooth transitions
      const fields = {
        'form-product-id': data.product_id,
        'form-type': data.type,
        'form-air-temp': data.air_temp,
        'form-proc-temp': data.proc_temp,
        'form-rpm': data.rpm,
        'form-torque': data.torque,
        'form-tool-wear': data.tool_wear
      };

      for (const [id, value] of Object.entries(fields)) {
        const el = document.getElementById(id);
        if (el) {
          el.value = value;
          // Apply a temporary highlight style
          el.style.borderColor = 'rgba(255, 30, 30, 0.6)';
          el.style.backgroundColor = 'rgba(255, 30, 30, 0.05)';
          setTimeout(() => {
            el.style.borderColor = '';
            el.style.backgroundColor = '';
          }, 1000);
        }
      }
      
      // Auto trigger prediction submit
      await submitPrediction();
      
    } else {
      console.error('Failed to load sample dataset row', data.error);
    }
  } catch (err) {
    console.error('Error fetching sample data', err);
  } finally {
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.innerHTML = `<i class="fa-solid fa-rotate"></i> Autoload & Predict`;
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('predict-form');
  if (form) {
    form.addEventListener('submit', submitPrediction);
  }
  
  const autoloadBtn = document.getElementById('autoload-trigger');
  if (autoloadBtn) {
    autoloadBtn.addEventListener('click', autoloadSampleData);
  }
  
  // Start Telemetry Live updates
  fetchLiveData();
  setInterval(fetchLiveData, window.liveInterval || 4000);
});
