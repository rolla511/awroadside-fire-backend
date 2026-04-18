AW Roadside Fire WordPress plugin source.

Build the distributable plugin package with:

```bash
node scripts/build-wordpress.mjs
```

The generated plugin is written to:

```text
out/wordpress/awroadside-fire
```

Usage:

1. Set the Render service base URL in the plugin settings page.
2. Add shortcode `[awroadside_fire]` to the target WordPress page.
3. The frontend UI will call WordPress REST routes only.
4. WordPress proxies requests to the Render backend.
