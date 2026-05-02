<?php
/**
 * Plugin Name: AW Universal Bridge
 * Description: WordPress-to-Render API translator/proxy for frontend and admin flows.
 * Version: 1.0.0
 * Author: Awobe Inc
 */

if (!defined('ABSPATH')) {
    exit;
}

final class AW_Universal_Bridge {
    const OPTION_KEY = 'aw_universal_bridge_settings';
    const NONCE_ACTION = 'wp_rest';

    public function __construct() {
        add_action('admin_menu', [$this, 'register_settings_page']);
        add_action('admin_init', [$this, 'register_settings']);
        add_action('rest_api_init', [$this, 'register_routes']);
        add_action('init', [$this, 'register_shortcode']);
    }

    public function register_settings_page(): void {
        add_options_page(
            'AW Universal Bridge',
            'AW Universal Bridge',
            'manage_options',
            'aw-universal-bridge',
            [$this, 'render_settings_page']
        );
    }

    public function register_settings(): void {
        register_setting('aw_universal_bridge_group', self::OPTION_KEY, [
            'type' => 'array',
            'sanitize_callback' => [$this, 'sanitize_settings'],
            'default' => [
                'base_url' => '',
                'timeout' => 20,
                'debug' => 0,
            ],
        ]);

        add_settings_section(
            'aw_universal_bridge_main',
            'Bridge Settings',
            function () {
                echo '<p>Configure the Render backend connection.</p>';
            },
            'aw-universal-bridge'
        );

        add_settings_field(
            'base_url',
            'Render Base URL',
            [$this, 'render_base_url_field'],
            'aw-universal-bridge',
            'aw_universal_bridge_main'
        );

        add_settings_field(
            'timeout',
            'Request Timeout',
            [$this, 'render_timeout_field'],
            'aw-universal-bridge',
            'aw_universal_bridge_main'
        );

        add_settings_field(
            'debug',
            'Debug Logging',
            [$this, 'render_debug_field'],
            'aw-universal-bridge',
            'aw_universal_bridge_main'
        );
    }

    public function sanitize_settings(array $input): array {
        return [
            'base_url' => isset($input['base_url']) ? esc_url_raw(rtrim($input['base_url'], '/')) : '',
            'timeout' => isset($input['timeout']) ? max(5, min(60, intval($input['timeout']))) : 20,
            'debug' => !empty($input['debug']) ? 1 : 0,
        ];
    }

    public function render_base_url_field(): void {
        $settings = get_option(self::OPTION_KEY, []);
        $value = esc_attr($settings['base_url'] ?? '');
        echo "<input type='url' name='" . esc_attr(self::OPTION_KEY) . "[base_url]' value='{$value}' class='regular-text' placeholder='https://your-render-service.onrender.com' />";
    }

    public function render_timeout_field(): void {
        $settings = get_option(self::OPTION_KEY, []);
        $value = intval($settings['timeout'] ?? 20);
        echo "<input type='number' name='" . esc_attr(self::OPTION_KEY) . "[timeout]' value='{$value}' min='5' max='60' />";
    }

    public function render_debug_field(): void {
        $settings = get_option(self::OPTION_KEY, []);
        $checked = !empty($settings['debug']) ? 'checked' : '';
        echo "<label><input type='checkbox' name='" . esc_attr(self::OPTION_KEY) . "[debug]' value='1' {$checked} /> Enable debug logging to PHP error log</label>";
    }

    public function render_settings_page(): void {
        ?>
        <div class="wrap">
            <h1>AW Universal Bridge</h1>
            <form method="post" action="options.php">
                <?php
                settings_fields('aw_universal_bridge_group');
                do_settings_sections('aw-universal-bridge');
                submit_button();
                ?>
            </form>
        </div>
        <?php
    }

    public function register_shortcode(): void {
        add_shortcode('aw_universal_app', [$this, 'render_shortcode']);
    }

    public function render_shortcode(array $atts = []): string {
        $nonce = wp_create_nonce(self::NONCE_ACTION);
        $root = esc_url_raw(rest_url('aw-bridge/v1'));
        $user = wp_get_current_user();

        ob_start();
        ?>
        <div id="aw-universal-app"
             data-rest-root="<?php echo esc_attr($root); ?>"
             data-rest-nonce="<?php echo esc_attr($nonce); ?>"
             data-user-id="<?php echo esc_attr($user->ID ?: 0); ?>">
            <div class="aw-loading">Loading…</div>
        </div>

        <script>
        (function () {
          const el = document.getElementById('aw-universal-app');
          if (!el) return;

          const root = el.dataset.restRoot;
          const nonce = el.dataset.restNonce;

          async function api(path, options = {}) {
            const response = await fetch(root + path, {
              method: options.method || 'GET',
              headers: {
                'Content-Type': 'application/json',
                'X-WP-Nonce': nonce
              },
              body: options.body ? JSON.stringify(options.body) : undefined,
              credentials: 'same-origin'
            });

            const json = await response.json().catch(() => ({}));
            if (!response.ok) {
              throw new Error(json.message || 'Request failed');
            }
            return json;
          }

          api('/health')
            .then((data) => {
              el.innerHTML = `
                <h2>AW Universal App</h2>
                <p>Bridge status: <strong>${data.status || 'ok'}</strong></p>
                <button id="aw-guest-btn">Continue as Guest</button>
              `;

              const btn = document.getElementById('aw-guest-btn');
              if (btn) {
                btn.addEventListener('click', async () => {
                  try {
                    const result = await api('/request/guest', {
                      method: 'POST',
                      body: {
                        serviceType: 'jumpstart',
                        location: 'Mercer County',
                        source: 'wordpress'
                      }
                    });
                    alert('Guest request sent: ' + JSON.stringify(result));
                  } catch (err) {
                    alert(err.message);
                  }
                });
              }
            })
            .catch((err) => {
              el.innerHTML = `<p style="color:red;">Bridge error: ${err.message}</p>`;
            });
        })();
        </script>
        <?php
        return ob_get_clean();
    }

    public function register_routes(): void {
        $routes = [
            ['GET', '/health', '/health', '__return_true'],
            ['POST', '/auth/login', '/api/auth/login', '__return_true'],
            ['POST', '/auth/logout', '/api/auth/logout', '__return_true'],
            ['POST', '/request/guest', '/api/requests/guest', '__return_true'],
            ['POST', '/request/member', '/api/requests/member', [$this, 'require_logged_in']],
            ['GET', '/request/history', '/api/requests/history', [$this, 'require_logged_in']],
            ['POST', '/subscription/start', '/api/subscriptions/start', [$this, 'require_logged_in']],
            ['GET', '/subscription/status', '/api/subscriptions/status', [$this, 'require_logged_in']],
            ['POST', '/provider/apply', '/api/providers/apply', '__return_true'],
            ['POST', '/provider/login', '/api/providers/login', '__return_true'],
            ['GET', '/provider/jobs', '/api/providers/jobs', [$this, 'require_logged_in']],
            ['POST', '/provider/jobs/accept', '/api/providers/jobs/accept', [$this, 'require_logged_in']],
            ['POST', '/provider/jobs/finish', '/api/providers/jobs/finish', [$this, 'require_logged_in']],
            ['GET', '/admin/requests', '/api/admin/requests', [$this, 'require_admin']],
            ['GET', '/admin/subscribers', '/api/admin/subscribers', [$this, 'require_admin']],
            ['POST', '/admin/refund', '/api/admin/refund', [$this, 'require_admin']],
            ['POST', '/admin/payout', '/api/admin/payout', [$this, 'require_admin']],
            ['POST', '/admin/provider/approve', '/api/admin/provider/approve', [$this, 'require_admin']],
        ];

        foreach ($routes as [$method, $wpRoute, $backendPath, $permission]) {
            register_rest_route('aw-bridge/v1', $wpRoute, [
                'methods' => $method,
                'callback' => function (WP_REST_Request $request) use ($backendPath) {
                    return $this->proxy_request($request, $backendPath);
                },
                'permission_callback' => $permission,
            ]);
        }
    }

    public function require_logged_in(): bool {
        return is_user_logged_in();
    }

    public function require_admin(): bool {
        return current_user_can('manage_options');
    }

    private function get_settings(): array {
        $settings = get_option(self::OPTION_KEY, []);
        return wp_parse_args($settings, [
            'base_url' => '',
            'timeout' => 20,
            'debug' => 0,
        ]);
    }

    private function proxy_request(WP_REST_Request $request, string $backendPath) {
        $settings = $this->get_settings();
        $baseUrl = trim($settings['base_url']);

        if (empty($baseUrl)) {
            return new WP_REST_Response([
                'message' => 'Render base URL is not configured.'
            ], 500);
        }

        $url = $baseUrl . $backendPath;

        $query = $request->get_query_params();
        if (!empty($query)) {
            $url = add_query_arg($query, $url);
        }

        $headers = [
            'Accept' => 'application/json',
            'Content-Type' => 'application/json',
            'X-Forwarded-By' => 'AW-Universal-Bridge',
            'X-WordPress-User' => strval(get_current_user_id()),
            'X-WordPress-Site' => home_url(),
        ];

        $authHeader = $request->get_header('authorization');
        if (!empty($authHeader)) {
            $headers['Authorization'] = $authHeader;
        }

        if (is_user_logged_in() && empty($authHeader)) {
            $storedToken = get_user_meta(get_current_user_id(), 'aw_render_token', true);
            if (!empty($storedToken)) {
                $headers['Authorization'] = 'Bearer ' . $storedToken;
            }
        }

        $body = null;
        if (!in_array($request->get_method(), ['GET', 'DELETE'], true)) {
            $json = $request->get_json_params();
            $body = !empty($json) ? wp_json_encode($json) : wp_json_encode($request->get_body_params());
        }

        $args = [
            'method' => $request->get_method(),
            'headers' => $headers,
            'timeout' => intval($settings['timeout']),
            'redirection' => 3,
        ];

        if ($body !== null) {
            $args['body'] = $body;
        }

        if (!empty($settings['debug'])) {
            error_log('[AW Bridge] Proxying ' . $request->get_method() . ' ' . $url);
        }

        $response = wp_remote_request($url, $args);

        if (is_wp_error($response)) {
            return new WP_REST_Response([
                'message' => 'Proxy request failed.',
                'error' => $response->get_error_message(),
            ], 502);
        }

        $statusCode = wp_remote_retrieve_response_code($response);
        $responseBody = wp_remote_retrieve_body($response);
        $responseHeaders = wp_remote_retrieve_headers($response);

        $decoded = json_decode($responseBody, true);

        if (is_array($decoded) && !empty($decoded['token']) && is_user_logged_in()) {
            update_user_meta(get_current_user_id(), 'aw_render_token', sanitize_text_field($decoded['token']));
        }

        if ($backendPath === '/api/auth/logout' && is_user_logged_in()) {
            delete_user_meta(get_current_user_id(), 'aw_render_token');
        }

        if (!is_array($decoded)) {
            return new WP_REST_Response([
                'message' => 'Backend returned non-JSON response.',
                'raw' => $responseBody,
            ], $statusCode ?: 502);
        }

        $wpResponse = new WP_REST_Response($decoded, $statusCode ?: 200);

        if (!empty($responseHeaders['x-request-id'])) {
            $wpResponse->header('X-Backend-Request-Id', $responseHeaders['x-request-id']);
        }

        return $wpResponse;
    }
}

new AW_Universal_Bridge();
