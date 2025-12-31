// Socket.IO connection for real-time updates
const socket = io.connect(window.location.origin);

// Active downloads tracking
const activeDownloads = {};

// DOM Elements
const urlInput = document.getElementById('urlInput');
const formatSelect = document.getElementById('formatSelect');
const qualitySelect = document.getElementById('qualitySelect');
const pathInput = document.getElementById('pathInput');
const pathStatus = document.getElementById('pathStatus');
const validatePathBtn = document.getElementById('validatePath');
const modeToggle = document.getElementById('modeToggle');
const urlCount = document.getElementById('urlCount');
const activeDownloadsContainer = document.getElementById('activeDownloads');
const historyList = document.getElementById('historyList');
const searchHistory = document.getElementById('searchHistory');
const refreshHistoryBtn = document.getElementById('refreshHistoryBtn');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadHistory();
  setupEventListeners();
  setupSocketListeners();
  updateQualityOptions();
  handleMobileDetection();
  
  // GSAP Animations
  gsap.from('header', {opacity: 0, y: -50, duration: 1, ease: 'power2.out'});
  gsap.from('.download-section', {opacity: 0, y: 50, duration: 1, delay: 0.2, ease: 'power2.out'});
  gsap.from('.history-section', {opacity: 0, y: 50, duration: 1, delay: 0.4, ease: 'power2.out'});
  gsap.from('.additional-features', {opacity: 0, y: 50, duration: 1, delay: 0.6, ease: 'power2.out'});
  gsap.from('footer', {opacity: 0, y: 50, duration: 1, delay: 0.8, ease: 'power2.out'});

  // Request notification permission
  if ('Notification' in window) {
    Notification.requestPermission();
  }
});

// Device Detection
function handleMobileDetection() {
  if (isMobile()) {
    pathInput.style.display = 'none';
    validatePathBtn.style.display = 'none';
    pathStatus.style.display = 'none';
  }
}

function isMobile() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

// Event Listeners
function setupEventListeners() {
  urlInput.addEventListener('input', updateURLCount);
  formatSelect.addEventListener('change', updateQualityOptions);
  downloadBtn.addEventListener('click', startDownload);
  validatePathBtn.addEventListener('click', validatePath);
  modeToggle.addEventListener('click', toggleTheme);
  refreshHistoryBtn.addEventListener('click', loadHistory);
  clearHistoryBtn.addEventListener('click', clearHistory);
  searchHistory.addEventListener('input', filterHistory);
}

// Socket.IO Listeners
function setupSocketListeners() {
  socket.on('download_progress', (data) => {
    updateDownloadProgress(data);
  });
  
  socket.on('download_complete', (data) => {
    completeDownload(data);
  });
  
  socket.on('download_error', (data) => {
    showError(data);
  });
}

// Update URL Count
function updateURLCount() {
  const urls = urlInput.value.split('\n').filter(url => url.trim());
  urlCount.textContent = urls.length;
}

// Update Quality Options based on format
function updateQualityOptions() {
  const format = formatSelect.value;
  const quality = qualitySelect;
  
  quality.innerHTML = '';
  
  if (format === 'mp4') {
    quality.innerHTML = `
      <option value="2160p">4K (2160p)</option>
      <option value="1440p">2K (1440p)</option>
      <option value="1080p" selected>Full HD (1080p)</option>
      <option value="720p">HD (720p)</option>
      <option value="480p">SD (480p)</option>
      <option value="360p">Low (360p)</option>
      <option value="best">Best Available</option>
    `;
  } else if (format === 'mp3' || format === 'wav') {
    quality.innerHTML = `
      <option value="320kbps">320 kbps (Best)</option>
      <option value="256kbps">256 kbps</option>
      <option value="192kbps" selected>192 kbps</option>
      <option value="128kbps">128 kbps</option>
      <option value="best">Best Available</option>
    `;
  } else {
    quality.innerHTML = `<option value="best">Best Available</option>`;
  }
}

// Validate Path
async function validatePath() {
  const path = pathInput.value.trim();
  
  if (!path) {
    showPathStatus('Please enter a path', 'invalid');
    return;
  }
  
  try {
    const response = await fetch('/validate_path', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path })
    });
    
    const data = await response.json();
    
    if (data.valid) {
      showPathStatus('✓ Path is valid', 'valid');
    } else {
      showPathStatus('✗ ' + data.message, 'invalid');
    }
  } catch (error) {
    showPathStatus('Error validating path', 'invalid');
  }
}

function showPathStatus(message, type) {
  pathStatus.textContent = message;
  pathStatus.className = `path-status ${type}`;
}

// Start Download
async function startDownload() {
  const urls = urlInput.value.split('\n').filter(url => url.trim());
  const format = formatSelect.value;
  const quality = qualitySelect.value;
  let path = pathInput.value.trim();
  
  if (isMobile()) {
    path = ''; // Force temp on mobile
  }
  
  if (urls.length === 0) {
    alert('Please enter at least one URL');
    return;
  }
  
  // Disable button during download
  downloadBtn.disabled = true;
  downloadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Starting...';
  
  // Clear active downloads display
  clearActiveDownloads();
  
  // Create download items
  urls.forEach((url, index) => {
    const downloadId = `download_${index}_${Date.now()}`;
    createDownloadItem(downloadId, url, format, quality);
    activeDownloads[downloadId] = { url, format, quality };
  });
  
  try {
    const response = await fetch('/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        urls,
        format,
        quality,
        path
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      showNotification('Downloads Complete!', `Successfully downloaded ${data.results.length} file(s)`);
      
      // Handle auto-download
      if (data.download_url) {
        window.location.href = data.download_url;
      } else if (data.path) {
        showNotification('Saved', `Files saved to ${data.path}`);
      }
      
      // Clear input
      urlInput.value = '';
      updateURLCount();
      
      // Reload history
      setTimeout(loadHistory, 1000);
    } else {
      alert('Download failed: ' + (data.errors.map(e => e.error).join(', ') || 'Unknown error'));
    }
    
  } catch (error) {
    console.error('Download error:', error);
    alert('Download failed: ' + error.message);
  } finally {
    downloadBtn.disabled = false;
    downloadBtn.innerHTML = '<i class="fas fa-download"></i> Start Download';
  }
}

// Clear Active Downloads
function clearActiveDownloads() {
  activeDownloadsContainer.innerHTML = '';
  Object.keys(activeDownloads).forEach(key => delete activeDownloads[key]);
}

// Create Download Item
function createDownloadItem(downloadId, url, format, quality) {
  const item = document.createElement('div');
  item.className = 'download-item';
  item.id = downloadId;
  
  // Extract domain for display
  let displayUrl = url;
  try {
    const urlObj = new URL(url);
    displayUrl = urlObj.hostname;
  } catch (e) {}
  
  item.innerHTML = `
    <div class="download-header">
      <div class="download-title">${displayUrl}</div>
      <div class="download-status">Initializing...</div>
    </div>
    <div class="progress-bar-container">
      <div class="progress-bar-fill" style="width: 0%"></div>
    </div>
    <div class="download-info">
      <div class="info-item">
        <span class="info-label">Progress</span>
        <span class="info-value progress-text">0%</span>
      </div>
      <div class="info-item">
        <span class="info-label">Speed</span>
        <span class="info-value speed-text">-</span>
      </div>
      <div class="info-item">
        <span class="info-label">ETA</span>
        <span class="info-value eta-text">-</span>
      </div>
      <div class="info-item">
        <span class="info-label">Downloaded</span>
        <span class="info-value downloaded-text">0 B / Unknown</span>
      </div>
    </div>
  `;
  
  activeDownloadsContainer.appendChild(item);
  gsap.from(item, {opacity: 0, x: -50, duration: 0.5, ease: 'power2.out'});
}

// Update Download Progress
function updateDownloadProgress(data) {
  const item = document.getElementById(data.download_id);
  if (!item) return;
  
  const progressBar = item.querySelector('.progress-bar-fill');
  const progressText = item.querySelector('.progress-text');
  const speedText = item.querySelector('.speed-text');
  const etaText = item.querySelector('.eta-text');
  const downloadedText = item.querySelector('.downloaded-text');
  const statusBadge = item.querySelector('.download-status');
  
  const percentNum = parseFloat(data.percent) || 0;
  progressBar.style.width = `${percentNum}%`;
  progressText.textContent = data.percent;
  speedText.textContent = data.speed || '-';
  etaText.textContent = data.eta || '-';
  downloadedText.textContent = `${data.downloaded || '0 B'} / ${data.total || 'Unknown'}`;
  statusBadge.textContent = data.status || 'Downloading...';
}

// Complete Download
function completeDownload(data) {
  const item = document.getElementById(data.download_id);
  if (!item) return;
  
  const progressBar = item.querySelector('.progress-bar-fill');
  const progressText = item.querySelector('.progress-text');
  const statusBadge = item.querySelector('.download-status');
  const downloadTitle = item.querySelector('.download-title');
  
  progressBar.style.width = '100%';
  progressText.textContent = '100%';
  statusBadge.textContent = 'Complete';
  statusBadge.style.background = 'var(--secondary)';
  downloadTitle.textContent = data.title || 'Download Complete';
  
  // Animate completion
  gsap.to(item, {background: 'rgba(34, 197, 94, 0.1)', duration: 0.5});
  
  // Remove after 5s
  setTimeout(() => {
    gsap.to(item, {opacity: 0, x: 100, duration: 0.3, onComplete: () => item.remove()});
  }, 5000);
}

// Show Error
function showError(data) {
  const item = document.getElementById(data.download_id);
  if (!item) return;
  
  const statusBadge = item.querySelector('.download-status');
  statusBadge.textContent = 'Error';
  statusBadge.style.background = 'var(--danger)';
  
  // Animate error
  gsap.to(item, {background: 'rgba(239, 68, 68, 0.1)', duration: 0.5});
  
  console.error('Download error:', data.error);
}

// Load History
async function loadHistory() {
  try {
    const response = await fetch('/history');
    const data = await response.json();
    
    historyList.innerHTML = '';
    
    if (data.length === 0) {
      historyList.innerHTML = `
        <div class="no-downloads">
          <i class="fas fa-history"></i>
          <p>No download history</p>
        </div>
      `;
      return;
    }
    
    data.forEach(item => {
      const historyItem = createHistoryItem(item);
      historyList.appendChild(historyItem);
    });
  } catch (error) {
    console.error('Error loading history:', error);
    historyList.innerHTML = '<div class="loading">Error loading history</div>';
  }
}

// Create History Item
function createHistoryItem(item) {
  const div = document.createElement('div');
  div.className = 'history-item';
  div.dataset.id = item.id;
  
  const date = new Date(item.timestamp);
  const formattedDate = date.toLocaleString();
  
  div.innerHTML = `
    <div class="history-info">
      <div class="history-title">${item.title || 'Unknown Title'}</div>
      <div class="history-meta">
        <span><i class="fas fa-calendar"></i> ${formattedDate}</span>
        <span><i class="fas fa-file"></i> ${item.file_format.toUpperCase()}</span>
        <span><i class="fas fa-signal"></i> ${item.quality || 'N/A'}</span>
        <span><i class="fas fa-hdd"></i> ${item.file_size || 'N/A'}</span>
      </div>
    </div>
    <div class="history-actions">
      <button class="icon-btn" onclick="copyPath('${item.download_path}')" title="Copy Path">
        <i class="fas fa-copy"></i>
      </button>
      <button class="icon-btn delete" onclick="deleteHistoryItem(${item.id})" title="Delete">
        <i class="fas fa-trash-alt"></i>
      </button>
    </div>
  `;
  
  return div;
}

// Copy Path to Clipboard
function copyPath(path) {
  if (!path) return;
  
  navigator.clipboard.writeText(path).then(() => {
    showNotification('Copied!', 'File path copied to clipboard');
  }).catch(err => {
    console.error('Failed to copy:', err);
  });
}

// Delete History Item
async function deleteHistoryItem(id) {
  if (!confirm('Delete this history item?')) return;
  
  try {
    await fetch(`/delete_history/${id}`, { method: 'DELETE' });
    loadHistory();
  } catch (error) {
    console.error('Error deleting history item:', error);
  }
}

// Clear History
async function clearHistory() {
  if (!confirm('Clear all download history?')) return;
  
  try {
    await fetch('/clear_history', { method: 'POST' });
    loadHistory();
    showNotification('Cleared', 'Download history cleared');
  } catch (error) {
    console.error('Error clearing history:', error);
  }
}

// Filter History
function filterHistory() {
  const searchTerm = searchHistory.value.toLowerCase();
  const items = document.querySelectorAll('.history-item');
  
  items.forEach(item => {
    const text = item.textContent.toLowerCase();
    item.style.display = text.includes(searchTerm) ? '' : 'none';
  });
}

// Toggle Theme
function toggleTheme() {
  document.body.classList.toggle('light-mode');
  
  const icon = modeToggle.querySelector('i');
  if (document.body.classList.contains('light-mode')) {
    icon.className = 'fas fa-sun';
  } else {
    icon.className = 'fas fa-moon';
  }
}

// Show Notification
function showNotification(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, {
      body,
      icon: '/static/icon.png'
    });
  }
  
  // In-app notification
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: var(--primary);
    color: white;
    padding: 1rem 1.5rem;
    border-radius: 12px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
    z-index: 1000;
    opacity: 0;
  `;
  notification.innerHTML = `
    <strong>${title}</strong><br>
    <small>${body}</small>
  `;
  
  document.body.appendChild(notification);
  gsap.to(notification, {opacity: 1, x: -20, duration: 0.3, ease: 'power2.out'});
  
  setTimeout(() => {
    gsap.to(notification, {opacity: 0, x: 20, duration: 0.3, ease: 'power2.in', onComplete: () => notification.remove()});
  }, 3000);
}