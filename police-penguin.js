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
    // Reuse the exact full-screen card treatment used by the SQL-injection penguin.
    overlay.className = 'sql-prank-overlay revealed police-penguin-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'policePenguinTitle');
    overlay.innerHTML = `
      <section class="sql-prank-card police-penguin-card">
        <div class="sql-prank-top">
          <span class="sql-prank-alert-dot"></span>
          JVAULT SECURITY THEATRE
          <span class="sql-prank-code"># 002</span>
        </div>
        <div class="sql-prank-reveal">
          <div class="sql-prank-label">REPEATED LOGIN ATTEMPTS DETECTED</div>
          <div class="sql-prank-reveal-layout">
            <div class="sql-prank-character">
              <img class="sql-prank-penguin" src="./tired%20penguin%20police.png" alt="Tired police penguin">
            </div>
            <div class="sql-prank-dialogue">
              <div class="sql-prank-speaker">JVAULT POLICE DEPARTMENT</div>
              <h2 id="policePenguinTitle">Four attempts? We need to talk.</h2>
              <div class="sql-prank-speech">
                <p class="sql-prank-roast">I was off duty, bro. But after four failed login attempts, you somehow managed to bring the police penguin back. Take a breath and check your credentials.</p>
              </div>
            </div>
          </div>
          <button type="button" class="sql-prank-close police-penguin-dismiss">Alright, officer.</button>
          <p class="sql-prank-foot">The vault is still protected. This is your warning from the penguin.</p>
        </div>
      </section>`;

    document.body.appendChild(overlay);
    const closeButton = overlay.querySelector('.police-penguin-dismiss');

    function close() {
      overlay.remove();
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
      if (failedLoginAttempts >= 4) showPolicePenguinPopup();
    }
    return response;
  };
})();