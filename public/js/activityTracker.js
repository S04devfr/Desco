/**
 * amoCRM-Grade Real-Time Client Activity & Inactivity Tracker
 * Tracks user mouse, keyboard, scrolling and page visibility.
 * Auto-detects breaks (idle state) after 3 minutes of inactivity.
 */
(function () {
  'use strict';

  const HEARTBEAT_INTERVAL_MS = 30 * 1000; // Send heartbeat every 30 seconds
  const IDLE_TIMEOUT_MS = 3 * 60 * 1000;    // 3 minutes without action = Idle/Break

  let lastActivityTime = Date.now();
  let isIdle = false;
  let heartbeatTimer = null;
  let idleCheckTimer = null;

  function resetActivity(event) {
    lastActivityTime = Date.now();

    if (isIdle) {
      isIdle = false;
      // User just returned from break! Send immediate ping to switch status back to active
      sendHeartbeat({ isIdle: false, action: 'user_active' });
    }
  }

  function checkIdleState() {
    const elapsed = Date.now() - lastActivityTime;
    const isDocumentHidden = document.hidden || document.visibilityState === 'hidden';

    if ((elapsed >= IDLE_TIMEOUT_MS || isDocumentHidden) && !isIdle) {
      isIdle = true;
      // Switched to Idle / Tanaffusda
      sendHeartbeat({ isIdle: true, action: 'idle_start' });
    }
  }

  async function sendHeartbeat(extraPayload = {}) {
    try {
      const payload = {
        isIdle,
        timestamp: new Date().toISOString(),
        ...extraPayload
      };

      await fetch('/api/activity/ping', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify(payload),
        keepalive: true
      });
    } catch (e) {
      // Ignore network errors silently
    }
  }

  // Hook global user interaction events (debounced / throttled)
  const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
  let throttleTimer = null;

  events.forEach(eventType => {
    window.addEventListener(eventType, () => {
      if (!throttleTimer) {
        throttleTimer = setTimeout(() => {
          resetActivity();
          throttleTimer = null;
        }, 1000);
      }
    }, { passive: true });
  });

  // Track tab visibility changes
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      checkIdleState();
    } else {
      resetActivity();
    }
  });

  // Track page unload
  window.addEventListener('beforeunload', () => {
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/activity/ping', JSON.stringify({ isIdle: true, action: 'unload' }));
      }
    } catch (e) {}
  });

  // Start intervals
  function startTracking() {
    // Initial heartbeat on page load
    sendHeartbeat({ isIdle: false, action: 'page_load' });

    heartbeatTimer = setInterval(() => {
      checkIdleState();
      sendHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);

    idleCheckTimer = setInterval(checkIdleState, 10 * 1000);
  }

  // Public helper to track business actions
  window.trackUserAction = function (actionName) {
    resetActivity();
    sendHeartbeat({ isIdle: false, action: actionName });
  };

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startTracking);
  } else {
    startTracking();
  }
})();
