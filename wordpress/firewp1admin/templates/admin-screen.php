<section class="firewp1admin-shell">
  <header class="firewp1admin-header">
    <p class="firewp1admin-eyebrow">AW Roadside Ops</p>
    <h1>Site operations admin</h1>
    <p class="firewp1admin-copy">Temporary admin page for sandbox flow testing. Use it to verify sign-in, request oversight, and subscriber visibility while the page map is being debugged.</p>
  </header>

  <section class="firewp1admin-panel firewp1admin-panel-tight">
    <div class="firewp1admin-status-grid">
      <div class="firewp1admin-status-card">
        <span>Dispatch</span>
        <strong id="firewp1admin-backend-status">...</strong>
        <small id="firewp1admin-backend-detail">Checking availability</small>
      </div>
      <div class="firewp1admin-status-card">
        <span>Admin Session</span>
        <strong id="firewp1admin-session-role">Offline</strong>
        <small id="firewp1admin-session-detail">No admin session restored yet</small>
      </div>
      <div class="firewp1admin-status-card">
        <span>Requests</span>
        <strong id="firewp1admin-request-count">0</strong>
        <small id="firewp1admin-request-summary">Admin sign-in required</small>
      </div>
    </div>
  </section>

  <div class="firewp1admin-grid">
    <section class="firewp1admin-panel">
      <p class="firewp1admin-eyebrow">Access</p>
      <h2>Admin sign in</h2>
      <form id="firewp1admin-signin-form" class="firewp1admin-form">
        <label><span>Email</span><input name="email" type="email" placeholder="admin@example.com" required/></label>
        <label><span>Password</span><input name="password" type="password" placeholder="Password" required/></label>
        <label><span>2FA Code</span><input name="twoFactorCode" type="text" placeholder="2FA Code" required/></label>
        <label><span>Trusted Zone</span><input name="locationZone" type="text" placeholder="HOME_BASE"/></label>
        <button type="submit">Sign In</button>
        <div id="firewp1admin-signin-status" class="firewp1admin-feedback" hidden></div>
      </form>
    </section>

    <section class="firewp1admin-panel">
      <div class="firewp1admin-workboard-header">
        <div>
          <p class="firewp1admin-eyebrow">Dashboard</p>
          <h2>Runtime summary</h2>
        </div>
        <button type="button" id="firewp1admin-refresh">Refresh Board</button>
      </div>
      <div class="firewp1admin-note-card">
        <strong id="firewp1admin-dashboard-status">Admin sign-in required</strong>
        <p id="firewp1admin-dashboard-detail">Dashboard metrics will load after a valid admin session is established.</p>
      </div>
      <div class="firewp1admin-summary-grid">
        <div class="firewp1admin-summary-card"><span>Pending Payouts</span><strong id="firewp1admin-payouts-pending">0</strong></div>
        <div class="firewp1admin-summary-card"><span>Subscribers</span><strong id="firewp1admin-subscriber-count">0</strong></div>
        <div class="firewp1admin-summary-card"><span>Watchdog</span><strong id="firewp1admin-watchdog-state">Unknown</strong></div>
      </div>
      <div id="firewp1admin-work-status" class="firewp1admin-feedback" hidden></div>
    </section>
  </div>

  <div class="firewp1admin-grid firewp1admin-grid-secondary">
    <section class="firewp1admin-panel">
      <p class="firewp1admin-eyebrow">Requests</p>
      <h2>Request and payout board</h2>
      <div id="firewp1admin-financials" class="firewp1admin-list">
        <p class="firewp1admin-empty">Sign in as admin to load financial records.</p>
      </div>
    </section>

    <section class="firewp1admin-panel">
      <p class="firewp1admin-eyebrow">Subscribers</p>
      <h2>Subscriber overview</h2>
      <div id="firewp1admin-subscribers" class="firewp1admin-list">
        <p class="firewp1admin-empty">Sign in as admin to load subscriber records.</p>
      </div>
    </section>
  </div>
</section>
