(function() {
  const queueBtn = document.getElementById('queueBtn');
  const modeSelect = document.getElementById('modeSelect');
  const selectWrap = document.getElementById('selectWrap');

  // Generate or load a simple user id
  let userId = localStorage.getItem('cg_userId');
  if (!userId) {
    userId = (self.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2));
    localStorage.setItem('cg_userId', userId);
  }
  // Connect socket with userId for targeted queue updates
  const socket = io('/', { auth: { userId } });

  let isSearching = false;

  function updateFindButton() {
    if (isSearching) {
      queueBtn.textContent = 'Searching...';
      queueBtn.classList.add('searching');
      modeSelect.disabled = true;
      selectWrap.classList.add('disabled');
    } else {
      queueBtn.textContent = 'Find Game';
      queueBtn.classList.remove('searching');
      modeSelect.disabled = false;
      selectWrap.classList.remove('disabled');
    }
  }

  socket.on('connect', function() { /* connected */ });

  socket.on('initialState', function(payload) { /* not used in this mock */ });

  socket.on('queue:update', function(payload) { /* not used in this mock */ });

  socket.on('disconnect', function() { /* no-op */ });

  // If we don't receive initialState within 2 seconds, enable UI anyway
  // No backend integration needed for visuals, but socket remains for future use

  queueBtn.addEventListener('click', function() {
    const mode = modeSelect.value;
    if (!isSearching && mode !== 'quickplay') {
      alert('This queue is still under construction!');
      return;
    }
    isSearching = !isSearching;
    updateFindButton();
  });

  // Fallback UI state
  updateFindButton();
})();


