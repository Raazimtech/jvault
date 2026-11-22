(() => {
  'use strict';
  let failedLoginAttempts = 0;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    let requestUrl = '';
    try {
      const request = args[0];
      requestUrl = typeof request === 'string' ? request : request.url;
    } catch (_) {}
    if (requestUrl.includes('/functions/v1/jvault/login') && !response.ok) {
      failedLoginAttempts += 1;
      if (failedLoginAttempts > 3) {
        const callout = document.getElementById('policePenguinCallout');
        if (callout) callout.classList.add('visible');
      }
    }
    return response;
  };
})();