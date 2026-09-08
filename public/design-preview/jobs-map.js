
  // Outward-postcode centroids only — Homlle stores the outward postcode you choose,
  // never a street address, so nothing here is more precise than the sector.
  var BASE = [53.7965, -1.5478];            // LS1, Leeds city centre
  var MILES = 15;
  var JOBS = [
    { at: [53.7996, -1.5454], label: '2 offers · LS1–LS2', kind: 'offer',
      title: '2 offers awaiting your reply',
      meta: 'Regular clean · LS1 · Tue 8 · 13:00 · 2h · £36.00<br>End of tenancy · LS2 · Thu 10 · 10:00 · 5h · £95.00' },
    { at: [53.8180, -1.5760], label: 'LS6 · booked', kind: 'booked',
      title: 'Deep clean · 3 bed house', meta: 'Sun 6 · 09:00 · 3.5h · £68.00 · confirmed' }
  ];

  var map = L.map('map', { center: BASE, zoom: 11, scrollWheelZoom: false, zoomControl: false });
  L.control.zoom({ position: 'bottomleft' }).addTo(map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '© OpenStreetMap contributors'
  }).addTo(map);

  var radius = L.circle(BASE, {
    radius: MILES * 1609.34,
    color: '#e01030', weight: 2, dashArray: '6 5',
    fillColor: '#e01030', fillOpacity: .06
  }).addTo(map);
  radius.bindPopup('<strong>Your work area</strong>LS1, LS2, LS6 · ' + MILES + ' miles maximum travel');

  var CLUSTER = [53.8057, -1.5556];         // mean of the three outward-postcode centroids
  L.marker(CLUSTER, {
    icon: L.divIcon({ className: '', html: '<span class="job-dot offer" aria-hidden="true"></span>', iconSize: [16, 16], iconAnchor: [8, 8] }),
    title: '3 jobs across LS1, LS2 and LS6'
  }).addTo(map).bindPopup(
    '<strong>3 jobs in your work areas</strong>' +
    JOBS.map(function (j) { return j.title + ' — ' + j.meta; }).join('<br>')
  );

  // The 15 miles the page advertises is the frame, whatever size the container is.
  function frameRadius() {
    map.invalidateSize();
    map.fitBounds(radius.getBounds(), { padding: [6, 6] });
  }
  var legend = L.control({ position: 'topright' });
  legend.onAdd = function () {
    var box = L.DomUtil.create('div', 'map-legend');
    box.innerHTML = '<span>JOBS IN YOUR AREAS</span>' +
      JOBS.map(function (j) { return '<span>' + j.label + '</span>'; }).join('');
    return box;
  };
  legend.addTo(map);

  frameRadius();
  new ResizeObserver(frameRadius).observe(document.getElementById('map'));
