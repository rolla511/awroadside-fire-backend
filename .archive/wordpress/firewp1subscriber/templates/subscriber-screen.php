<section class="firewp1subscriber-shell">
  <div class="firewp1subscriber-hero">
    <div>
      <p class="firewp1subscriber-eyebrow">AW Roadside</p>
      <h1>Subscriber account and vehicle profile.</h1>
      <p class="firewp1subscriber-copy">Restore the member session, save vehicle details, and review subscriber request history without mixing guest request intake into the page.</p>
    </div>
    <div class="firewp1subscriber-status-grid">
      <div class="firewp1subscriber-status-card">
        <span>Dispatch</span>
        <strong id="firewp1subscriber-backend-status">...</strong>
        <small id="firewp1subscriber-backend-detail">Checking availability</small>
      </div>
      <div class="firewp1subscriber-status-card">
        <span>Member Session</span>
        <strong id="firewp1subscriber-session-role">Guest</strong>
        <small id="firewp1subscriber-session-detail">No backend session restored yet</small>
      </div>
      <div class="firewp1subscriber-status-card">
        <span>Subscriber Service Rate</span>
        <strong id="firewp1subscriber-service-rate">$40.00</strong>
        <small id="firewp1subscriber-price-detail">Subscriber service pricing</small>
      </div>
    </div>
  </div>

  <div class="firewp1subscriber-grid">
    <section class="firewp1subscriber-panel">
      <p class="firewp1subscriber-eyebrow">Session</p>
      <h2>Member sign in</h2>
      <form id="firewp1subscriber-signin-form" class="firewp1subscriber-form">
        <label><span>Username or Email</span><input name="identifier" type="text" placeholder="Username or email" required/></label>
        <label><span>Password</span><input name="password" type="password" placeholder="Password" required/></label>
        <button type="submit">Sign In</button>
        <div id="firewp1subscriber-signin-status" class="firewp1subscriber-feedback" hidden></div>
      </form>
      <div class="firewp1subscriber-link-row">
        <a id="firewp1subscriber-home-link" href="#">Home</a>
        <a id="firewp1subscriber-customer-link" href="#">Customer Page</a>
        <a id="firewp1subscriber-provider-link" href="#">Provider Page</a>
      </div>
    </section>

    <section class="firewp1subscriber-panel">
      <p class="firewp1subscriber-eyebrow">Membership</p>
      <h2>Subscriber profile setup</h2>
      <p class="firewp1subscriber-copy-tight">Store the vehicle on file and activate or refresh the subscriber profile after sign-in.</p>
      <form id="firewp1subscriber-setup-form" class="firewp1subscriber-form">
        <label><span>Vehicle Year</span><input name="year" type="text" placeholder="2022"/></label>
        <label><span>Vehicle Make</span><input name="make" type="text" placeholder="Ford"/></label>
        <label><span>Vehicle Model</span><input name="model" type="text" placeholder="Escape"/></label>
        <label><span>Vehicle Color</span><input name="color" type="text" placeholder="Blue"/></label>
        <label class="firewp1subscriber-full-span"><span>Payment Reference</span><input name="paymentMethodMasked" type="text" placeholder="****1111 or manual-test-mode"/></label>
        <button type="submit">Save Subscriber Profile</button>
        <div id="firewp1subscriber-setup-status" class="firewp1subscriber-feedback" hidden></div>
      </form>
    </section>
  </div>

  <div class="firewp1subscriber-grid firewp1subscriber-grid-secondary">
    <section class="firewp1subscriber-panel">
      <p class="firewp1subscriber-eyebrow">Status</p>
      <h2>Subscriber state</h2>
      <div class="firewp1subscriber-note-card">
        <strong id="firewp1subscriber-state">Subscriber inactive</strong>
        <p id="firewp1subscriber-detail">Sign in to load subscriber status and vehicle information.</p>
      </div>
    </section>

    <section class="firewp1subscriber-panel">
      <p class="firewp1subscriber-eyebrow">History</p>
      <h2>Member request history</h2>
      <div id="firewp1subscriber-history-list" class="firewp1subscriber-list">
        <p class="firewp1subscriber-empty">Sign in to load member request history.</p>
      </div>
    </section>
  </div>
</section>
