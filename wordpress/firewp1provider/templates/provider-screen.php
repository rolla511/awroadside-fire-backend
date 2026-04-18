<section class="firewp1provider-shell">
  <div class="firewp1provider-hero">
    <div>
      <p class="firewp1provider-eyebrow">AW Roadside</p>
      <h1>Provider workboard for WordPress.</h1>
      <p class="firewp1provider-copy">Sign in with a provider account, review incoming work, and move assigned roadside jobs through completion without exposing the full legacy shell.</p>
    </div>
    <div class="firewp1provider-status-grid">
      <div class="firewp1provider-status-card">
        <span>Dispatch</span>
        <strong id="firewp1provider-backend-status">...</strong>
        <small id="firewp1provider-backend-detail">Checking availability</small>
      </div>
      <div class="firewp1provider-status-card">
        <span>Provider Session</span>
        <strong id="firewp1provider-session-role">Guest</strong>
        <small id="firewp1provider-session-detail">No provider session restored yet</small>
      </div>
      <div class="firewp1provider-status-card">
        <span>Open Jobs</span>
        <strong id="firewp1provider-job-count">0</strong>
        <small id="firewp1provider-job-summary">Provider sign-in required</small>
      </div>
    </div>
  </div>

  <div class="firewp1provider-grid">
    <section class="firewp1provider-panel">
      <p class="firewp1provider-eyebrow">Provider Access</p>
      <h2>Provider sign in</h2>
      <form id="firewp1provider-signin-form" class="firewp1provider-form">
        <label><span>Username or Email</span><input name="identifier" type="text" placeholder="Username or email" required/></label>
        <label><span>Password</span><input name="password" type="password" placeholder="Password" required/></label>
        <button type="submit">Sign In</button>
        <div id="firewp1provider-signin-status" class="firewp1provider-feedback" hidden></div>
      </form>
      <div class="firewp1provider-link-row">
        <a id="firewp1provider-home-link" href="#">Home</a>
        <a id="firewp1provider-customer-link" href="#">Customer Page</a>
      </div>
    </section>

    <section class="firewp1provider-panel">
      <p class="firewp1provider-eyebrow">Compensation</p>
      <h2>Current payout targets</h2>
      <div class="firewp1provider-note-card">
        <strong>Guest service payout</strong>
        <p id="firewp1provider-guest-payout">$43.00 after platform and assignment fees.</p>
      </div>
      <div class="firewp1provider-note-card">
        <strong>Subscriber service payout</strong>
        <p id="firewp1provider-subscriber-payout">$38.00 after assignment fee.</p>
      </div>
    </section>
  </div>

  <section class="firewp1provider-panel firewp1provider-workboard">
    <div class="firewp1provider-workboard-header">
      <div>
        <p class="firewp1provider-eyebrow">Provider Queue</p>
        <h2>Available and assigned jobs</h2>
      </div>
      <button type="button" id="firewp1provider-refresh">Refresh Jobs</button>
    </div>
    <div id="firewp1provider-work-status" class="firewp1provider-feedback" hidden></div>
    <div id="firewp1provider-jobs" class="firewp1provider-job-list">
      <p class="firewp1provider-empty">Sign in as a provider to load work.</p>
    </div>
  </section>
</section>
