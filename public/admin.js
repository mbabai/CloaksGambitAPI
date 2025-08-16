(function () {
	var origin = window.location.origin.replace(/\/$/, '');
	var socket = io(origin + '/admin');
	var params = new URLSearchParams(window.location.search);
	var adminIdParam = params.get('adminId');
	var adminUserId = adminIdParam || localStorage.getItem('cg_userId') || null;
	var connectedUsersEl = document.getElementById('connectedUsers');
	var quickplayQueueEl = document.getElementById('quickplayQueue');
	var rankedQueueEl = document.getElementById('rankedQueue');
	var connectedUsersListEl = document.getElementById('connectedUsersList');
	var quickplayQueueListEl = document.getElementById('quickplayQueueList');
	var rankedQueueListEl = document.getElementById('rankedQueueList');

	function renderList(targetEl, ids) {
		if (!targetEl) return;
		targetEl.innerHTML = '';
		if (!Array.isArray(ids) || ids.length === 0) return;
		var frag = document.createDocumentFragment();
		ids.forEach(function (id) {
			var row = document.createElement('div');
			row.className = 'row';
			if (adminUserId && id === adminUserId) {
				var strong = document.createElement('strong');
				strong.textContent = id;
				row.appendChild(strong);
			} else {
				row.textContent = id;
			}
			frag.appendChild(row);
		});
		targetEl.appendChild(frag);
	}

	socket.on('connect', function () { /* no-op */ });
	socket.on('admin:metrics', function (payload) {
		if (!payload) return;
		connectedUsersEl.textContent = (payload.connectedUsers ?? 0);
		quickplayQueueEl.textContent = (payload.quickplayQueue ?? 0);
		rankedQueueEl.textContent = (payload.rankedQueue ?? 0);
		renderList(connectedUsersListEl, payload.connectedUserIds);
		renderList(quickplayQueueListEl, payload.quickplayQueueUserIds);
		renderList(rankedQueueListEl, payload.rankedQueueUserIds);
	});
})();


