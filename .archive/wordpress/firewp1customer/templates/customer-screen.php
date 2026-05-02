<section class="firewp1customer-shell">
  <div class="firewp1customer-hero">
    <div>
      <p class="firewp1customer-eyebrow">AW Roadside</p>
      <h1>Customer request flow built for WordPress.</h1>
      <p class="firewp1customer-copy">Submit a roadside request, restore your member session, and keep the customer data flow pointed at Render without dragging the whole app shell into WordPress.</p>
    </div>
    <div class="firewp1customer-status-grid">
      <div class="firewp1customer-status-card">
        <span>Dispatch</span>
        <strong id="firewp1customer-backend-status">...</strong>
        <small id="firewp1customer-backend-detail">Checking availability</small>
      </div>
      <div class="firewp1customer-status-card">
        <span>Priority Upgrade</span>
        <strong id="firewp1customer-priority-price">$25.00</strong>
        <small id="firewp1customer-price-detail">Backend-configured value</small>
      </div>
      <div class="firewp1customer-status-card">
        <span>Customer Session</span>
        <strong id="firewp1customer-session-role">Guest</strong>
        <small id="firewp1customer-session-detail">No backend session restored yet</small>
      </div>
    </div>
  </div>

  <div class="firewp1customer-grid">
    <section class="firewp1customer-panel">
      <p class="firewp1customer-eyebrow">Request</p>
      <h2>Submit roadside service</h2>
      <form id="firewp1customer-request-form" class="firewp1customer-form">
        <label><span>Full Name</span><input name="fullName" type="text" placeholder="Full Name" required/></label>
        <label><span>Phone Number</span><input name="phoneNumber" type="text" placeholder="Phone Number" required/></label>
        <label>
          <span>Service Type</span>
          <select name="serviceType">
            <option value="Jump Start">Jump Start</option>
            <option value="Lockout">Lockout</option>
            <option value="Tire Change">Tire Change</option>
            <option value="Gas Delivery">Gas Delivery</option>
            <option value="Battery Install">Battery Install</option>
          </select>
        </label>
        <label><span>Location / Address</span><input name="location" type="text" placeholder="Street, city, landmark" required/></label>
        <label class="firewp1customer-full-span"><span>Notes</span><textarea name="notes" placeholder="Vehicle color, parking spot, issue details"></textarea></label>
        <button type="submit" class="firewp1customer-primary">Submit Request</button>
        <div id="firewp1customer-request-status" class="firewp1customer-feedback" hidden></div>
      </form>
    </section>

    <section class="firewp1customer-panel">
      <p class="firewp1customer-eyebrow">Session</p>
      <h2>Quick sign in</h2>
      <form id="firewp1customer-signin-form" class="firewp1customer-form">
        <label><span>Username or Email</span><input name="identifier" type="text" placeholder="vipmember or email" required/></label>
        <label><span>Password</span><input name="password" type="password" placeholder="Password" required/></label>
        <button type="submit">Sign In</button>
        <div id="firewp1customer-signin-status" class="firewp1customer-feedback" hidden></div>
      </form>
      <div class="firewp1customer-link-row">
        <a id="firewp1customer-home-link" href="#">Back to Home</a>
        <a id="firewp1customer-provider-link" href="#">Provider Page</a>
      </div>
    </section>
  </div>

  <div class="firewp1customer-grid firewp1customer-grid-secondary">
    <section class="firewp1customer-panel" id="firewp1customer-subscribe-panel">
      <p class="firewp1customer-eyebrow">Membership</p>
      <h2>Subscriber setup</h2>
      <p class="firewp1customer-copy-tight">If you already have a backend session, store vehicle information and activate the subscriber profile here.</p>
      <form id="firewp1customer-subscribe-form" class="firewp1customer-form">
        <label><span>Vehicle Year</span><input name="year" type="text" placeholder="2020"/></label>
        <label><span>Vehicle Make</span><input name="make" type="text" placeholder="Ford"/></label>
        <label><span>Vehicle Model</span><input name="model" type="text" placeholder="F150"/></label>
        <label><span>Vehicle Color</span><input name="color" type="text" placeholder="Blue"/></label>
        <label class="firewp1customer-full-span"><span>Payment Reference</span><input name="paymentMethodMasked" type="text" placeholder="****1111 or manual-test-mode"/></label>
        <button type="submit">Activate Subscriber Profile</button>
        <div id="firewp1customer-subscribe-status" class="firewp1customer-feedback" hidden></div>
      </form>
    </section>

    <section class="firewp1customer-panel">
      <p class="firewp1customer-eyebrow">Account</p>
      <h2>Subscriber status and request history</h2>
      <div class="firewp1customer-note-card">
        <strong id="firewp1customer-subscriber-state">Subscriber inactive</strong>
        <p id="firewp1customer-subscriber-detail">Sign in to load subscriber status and saved vehicle information.</p>
      </div>
      <div class="firewp1customer-history">
        <h3>Request History</h3>
        <div id="firewp1customer-history-list" class="firewp1customer-list"></div>
      </div>
    </section>
  </div>
</section>
