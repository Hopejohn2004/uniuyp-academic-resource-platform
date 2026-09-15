document.addEventListener('submit', function (e) {
  var msg = e.target.getAttribute('data-confirm');
  if (msg && !window.confirm(msg)) e.preventDefault();
});
document.querySelectorAll('[data-bar-height]').forEach(function (el) {
  el.style.height = el.getAttribute('data-bar-height') + 'px';
});
