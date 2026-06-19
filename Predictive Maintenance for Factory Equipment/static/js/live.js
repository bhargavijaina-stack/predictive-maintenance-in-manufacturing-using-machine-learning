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

function updateLiveFeed(item) {
  const feed = document.getElementById('live-feed');
  if (!feed) return;
  const card = document.createElement('div');
  card.className = 'feed-card';
  card.innerHTML = renderFeedItem(item);
  feed.prepend(card);
  while (feed.children.length > 7) {
    feed.removeChild(feed.lastChild);
  }
}

function showPrediction(result) {
  const target = document.getElementById('prediction-result');
  if (!target) return;
  if (!result.success) {
    target.innerHTML = `<div class="result-card"><strong>Error</strong><p>${result.error}</p></div>`;
    return;
  }
  target.innerHTML = `
    <div class="result-card">
      <strong>Predicted failure:</strong>
      <p style="margin:0 0 12px; font-size:1.05rem;">${result.predicted_failure}</p>
      <div>${result.probabilities
        .slice(0, 4)
        .map((item) => `<small>${item.label}: ${Math.round(item.probability * 100)}%</small>`)
        .join('<br/>')}</div>
      <p class="xai-text" style="margin-top:16px;">${result.xai || ''}</p>
    </div>
  `;
}

async function fetchLiveData() {
  try {
    const response = await fetch('/live-data');
    const data = await response.json();
    if (data.success) {
      updateLiveFeed(data.item);
    }
  } catch (err) {
    console.warn('Live update failed', err);
  }
}

async function submitPrediction(event) {
  event.preventDefault();
  const form = event.target;
  const payload = new FormData(form);
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

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('predict-form');
  if (form) {
    form.addEventListener('submit', submitPrediction);
  }
  fetchLiveData();
  setInterval(fetchLiveData, window.liveInterval || 5000);
});
