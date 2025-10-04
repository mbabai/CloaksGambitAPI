const tabButtons = Array.from(document.querySelectorAll('.tab-button'));
const tabPanels = Array.from(document.querySelectorAll('.tab-panel'));

function setActiveTab(targetButton) {
  const tabName = targetButton.dataset.tab;

  tabButtons.forEach((button) => {
    const isActive = button === targetButton;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  tabPanels.forEach((panel) => {
    const isActive = panel.id === `${tabName}Tab`;
    panel.classList.toggle('active', isActive);
    if (isActive) {
      panel.removeAttribute('hidden');
    } else {
      panel.setAttribute('hidden', '');
    }
  });
}

function wireTabs() {
  tabButtons.forEach((button) => {
    const tabName = button.dataset.tab;
    const panel = document.getElementById(`${tabName}Tab`);

    if (!panel) {
      return;
    }

    const buttonId = `${tabName}TabButton`;
    button.id = buttonId;
    panel.setAttribute('aria-labelledby', buttonId);

    button.addEventListener('click', () => setActiveTab(button));
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wireTabs);
} else {
  wireTabs();
}
