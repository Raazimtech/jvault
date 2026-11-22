(() => {
  'use strict';
  let failedLoginAttempts = 0;
  let policePopupOpen = false;
  const originalFetch = window.fetch.bind(window);

  function showPolicePenguinPopup() {
    if (policePopupOpen || document.getElementById('policePenguinOverlay')) return;
    policePopupOpen = true;

    const overlay = document.createElement('div');
    overlay.id = 'policePenguinOverlay';
    overlay.className = 'police-penguin-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'policePenguinTitle');
    overlay.innerHTML = `
      <section class="police-penguin-modal">
        <div class="police-penguin-modal-kicker">JVAULT SECURITY</div>
        <img class="police-penguin-modal-image" src="./tired%20penguin%20police.png" alt="Tired police penguin">
        <div class="police-penguin-modal-copy">
          <h2 id="policePenguinTitle">Well, look who needs a visit.</h2>
          <p>Bro, I just got off duty. And you're still trying?</p>
        </div>
        <button type="button" class="police-penguin-dismiss">Alright, officer.</button>
      </section>`;
    document.body.appendChild(overlay);
    document.body.classList.add('police-penguin-modal-open');

    const closeButton = overlay.querySelector('.police-penguin-dismiss');
    function close() {
      overlay.remove();
      document.body.classList.remove('police-penguin-modal-open');
      document.removeEventListener('keydown', onKeyDown);
      policePopupOpen = false;
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') close();
    }
    closeButton.addEventListener('click', close);
    overlay.addEventListener('click', event => {
      if (event.target === overlay) close();
    });
    document.addEventListener('keydown', onKeyDown);
    closeButton.focus();
  }

  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    let requestUrl = '';
    try {
      const request = args[0];
      requestUrl = typeof request === 'string' ? request : request.url;
    } catch (_) {}
    if (requestUrl.includes('/functions/v1/jvault/login') && !response.ok) {
      failedLoginAttempts += 1;
      if (failedLoginAttempts > 3) showPolicePenguinPopup();
    }
    return response;
  };
})();
