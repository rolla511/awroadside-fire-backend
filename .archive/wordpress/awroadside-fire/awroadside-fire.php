<?php
/**
 * Plugin Name: AW Roadside Fire
 * Description: WordPress delivery layer for the AW Roadside fire website UI with REST proxy routes to the Render backend.
 * Version: 1.0.0
 */

if (!defined('ABSPATH')) {
    exit;
}

define('AWROADSIDE_FIRE_PATH', plugin_dir_path(__FILE__));
define('AWROADSIDE_FIRE_URL', plugin_dir_url(__FILE__));

add_action('admin_init', 'awroadside_fire_register_settings');
add_action('admin_menu', 'awroadside_fire_register_settings_page');
add_action('rest_api_init', 'awroadside_fire_register_rest_routes');
add_shortcode('awroadside_fire', 'awroadside_fire_render_shortcode');
add_action('template_redirect', 'awroadside_fire_handle_route_fallback', 1);

function awroadside_fire_register_settings() {
    register_setting('awroadside_fire', 'awroadside_fire_render_base_url', [
        'sanitize_callback' => 'esc_url_raw',
        'default' => '',
    ]);
}

function awroadside_fire_register_settings_page() {
    add_options_page(
        'AW Roadside Fire',
        'AW Roadside Fire',
        'manage_options',
        'awroadside-fire',
        'awroadside_fire_render_settings_page'
    );
}

function awroadside_fire_render_settings_page() {
    ?>
    <div class="wrap">
        <h1>AW Roadside Fire</h1>
        <form method="post" action="options.php">
            <?php settings_fields('awroadside_fire'); ?>
            <table class="form-table" role="presentation">
                <tr>
                    <th scope="row"><label for="awroadside_fire_render_base_url">Render Base URL</label></th>
                    <td>
                        <input
                            type="url"
                            class="regular-text"
                            id="awroadside_fire_render_base_url"
                            name="awroadside_fire_render_base_url"
                            value="<?php echo esc_attr(awroadside_fire_render_base_url()); ?>"
                            placeholder="https://your-render-service.onrender.com"
                        />
                        <p class="description">This should be the Render service root. The plugin will proxy to its <code>/api/*</code> routes.</p>
                    </td>
                </tr>
            </table>
            <?php submit_button('Save Settings'); ?>
        </form>
        <p>Use shortcode <code>[awroadside_fire]</code> on the page that should render the fire website UI.</p>
    </div>
    <?php
}

function awroadside_fire_render_shortcode() {
    awroadside_fire_enqueue_assets();
    ob_start();
    include AWROADSIDE_FIRE_PATH . 'templates/fire-ui.php';
    return ob_get_clean();
}

function awroadside_fire_enqueue_assets() {
    wp_enqueue_style(
        'awroadside-fire-fonts',
        'https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=Sora:wght@400;600;700;800&display=swap',
        [],
        null
    );
    wp_enqueue_style(
        'awroadside-fire-styles',
        AWROADSIDE_FIRE_URL . 'assets/fire-styles.css',
        ['awroadside-fire-fonts'],
        filemtime(AWROADSIDE_FIRE_PATH . 'assets/fire-styles.css')
    );
    wp_enqueue_script(
        'awroadside-fire-app',
        AWROADSIDE_FIRE_URL . 'assets/fire-app.js',
        [],
        filemtime(AWROADSIDE_FIRE_PATH . 'assets/fire-app.js'),
        true
    );
    wp_add_inline_script(
        'awroadside-fire-app',
        'window.AWRoadsideConfig = ' . wp_json_encode(awroadside_fire_frontend_config()) . ';',
        'before'
    );
}

function awroadside_fire_register_rest_routes() {
    register_rest_route('awroadside-fire/v1', '/config/frontend', [
        'methods' => 'GET',
        'callback' => 'awroadside_fire_rest_frontend_config',
        'permission_callback' => '__return_true',
    ]);

    register_rest_route('awroadside-fire/v1', '/config/routes', [
        'methods' => 'GET',
        'callback' => 'awroadside_fire_rest_route_config',
        'permission_callback' => '__return_true',
    ]);

    register_rest_route('awroadside-fire/v1', '/route/resolve', [
        'methods' => ['GET', 'POST'],
        'callback' => 'awroadside_fire_rest_route_resolve',
        'permission_callback' => '__return_true',
    ]);

    register_rest_route('awroadside-fire/v1', '/proxy/(?P<path>.+)', [
        'methods' => ['GET', 'POST'],
        'callback' => 'awroadside_fire_rest_proxy',
        'permission_callback' => '__return_true',
        'args' => [
            'path' => [
                'required' => true,
            ],
        ],
    ]);
}

function awroadside_fire_rest_frontend_config() {
    return rest_ensure_response(awroadside_fire_frontend_config());
}

function awroadside_fire_rest_route_config() {
    return rest_ensure_response([
        'pageUrls' => awroadside_fire_page_urls(),
        'buttonTargets' => awroadside_fire_button_targets(),
        'routeAliases' => awroadside_fire_route_aliases(),
    ]);
}

function awroadside_fire_rest_route_resolve(WP_REST_Request $request) {
    $params = array_filter([
        'route' => $request->get_param('route'),
        'screen' => $request->get_param('screen'),
        'intent' => $request->get_param('intent'),
        'path' => $request->get_param('path'),
        'slug' => $request->get_param('slug'),
    ], static function ($value) {
        return is_string($value) && $value !== '';
    });

    $match = awroadside_fire_match_route_request($params);
    if (!$match) {
        return new WP_REST_Response([
            'resolved' => false,
            'message' => 'No matching AW Roadside route was found.',
            'pageUrls' => awroadside_fire_page_urls(),
        ], 404);
    }

    $response = new WP_REST_Response([
        'resolved' => true,
        'route' => $match['route'],
        'targetUrl' => $match['targetUrl'],
        'matchedBy' => $match['matchedBy'],
        'buttonTargets' => awroadside_fire_button_targets(),
    ], 200);

    if ($request->get_param('redirect')) {
        $response->set_status(302);
        $response->header('Location', $match['targetUrl']);
    }

    return $response;
}

function awroadside_fire_rest_proxy(WP_REST_Request $request) {
    $base_url = awroadside_fire_render_base_url();
    if (!$base_url) {
        return new WP_Error('awroadside_fire_missing_base_url', 'Set the Render base URL in WordPress settings first.', ['status' => 500]);
    }

    $path = ltrim((string) $request['path'], '/');
    $remote_url = trailingslashit($base_url) . 'api/' . $path;
    $headers = [
        'Accept' => 'application/json',
    ];

    foreach (['authorization', 'content-type', 'x-location-zone', 'x-2fa-verified'] as $header_name) {
        $header_value = $request->get_header($header_name);
        if ($header_value !== '') {
            $headers[$header_name] = $header_value;
        }
    }

    $args = [
        'method' => $request->get_method(),
        'headers' => $headers,
        'timeout' => 20,
    ];

    $body = $request->get_body();
    if ($body !== '') {
        $args['body'] = $body;
    }

    $response = wp_remote_request($remote_url, $args);
    if (is_wp_error($response)) {
        return $response;
    }

    $status = wp_remote_retrieve_response_code($response);
    $payload = wp_remote_retrieve_body($response);
    $decoded = json_decode($payload, true);
    if (json_last_error() === JSON_ERROR_NONE) {
        return new WP_REST_Response($decoded, $status);
    }

    return new WP_REST_Response(['raw' => $payload], $status);
}

function awroadside_fire_frontend_config() {
    $remote_config = awroadside_fire_fetch_remote_json('/api/aw-roadside/frontend-config');
    $proxy_root = rest_url('awroadside-fire/v1/proxy');
    $page_urls = awroadside_fire_page_urls();
    $button_targets = awroadside_fire_button_targets();
    $current_route = awroadside_fire_current_route();
    $display_screen = $current_route === 'subscriber' ? 'customer' : $current_route;
    $entry_intent = $current_route === 'subscriber' ? 'subscribe' : '';

    return [
        'uiBaseUrl' => home_url('/'),
        'apiBaseUrl' => rest_url('awroadside-fire/v1/proxy/aw-roadside'),
        'rawApiBaseUrl' => $proxy_root,
        'adminApiBaseUrl' => rest_url('awroadside-fire/v1/proxy/admin'),
        'bootstrapHealthUrl' => rest_url('awroadside-fire/v1/proxy/aw-roadside/health'),
        'bootstrapFrontendConfigUrl' => rest_url('awroadside-fire/v1/config/frontend'),
        'routeConfigUrl' => rest_url('awroadside-fire/v1/config/routes'),
        'routeResolveUrl' => rest_url('awroadside-fire/v1/route/resolve'),
        'bootstrapManifestUrl' => rest_url('awroadside-fire/v1/proxy/compat/manifest'),
        'bootstrapAcknowledgeUrl' => rest_url('awroadside-fire/v1/proxy/compat/acknowledge'),
        'pageUrls' => $page_urls,
        'buttonTargets' => $button_targets,
        'frontendConfig' => [
            'apiBaseUrl' => rest_url('awroadside-fire/v1/proxy/aw-roadside'),
            'rawApiBaseUrl' => $proxy_root,
            'adminApiBaseUrl' => rest_url('awroadside-fire/v1/proxy/admin'),
            'uiBaseUrl' => home_url('/'),
            'priorityServicePrice' => isset($remote_config['priorityServicePrice']) ? $remote_config['priorityServicePrice'] : 25,
            'serviceBasePrice' => isset($remote_config['serviceBasePrice']) ? $remote_config['serviceBasePrice'] : 55,
            'paypalEnabled' => !empty($remote_config['paypalEnabled']),
            'securityLayer' => isset($remote_config['securityLayer']) ? $remote_config['securityLayer'] : 'aw-roadside-security',
            'entryRoute' => $current_route,
            'forcedScreen' => $display_screen,
            'entryIntent' => $entry_intent,
            'autoOpenMemberSignup' => $current_route === 'subscriber',
            'pageUrls' => $page_urls,
            'buttonTargets' => $button_targets,
            'routeFallbackEnabled' => true,
        ],
    ];
}

function awroadside_fire_fetch_remote_json($path) {
    $base_url = awroadside_fire_render_base_url();
    if (!$base_url) {
        return [];
    }

    $response = wp_remote_get(trailingslashit($base_url) . ltrim($path, '/'), [
        'headers' => ['Accept' => 'application/json'],
        'timeout' => 20,
    ]);
    if (is_wp_error($response)) {
        return [];
    }

    $decoded = json_decode(wp_remote_retrieve_body($response), true);
    return is_array($decoded) ? $decoded : [];
}

function awroadside_fire_render_base_url() {
    $configured = get_option('awroadside_fire_render_base_url', '');
    if (is_string($configured) && $configured !== '') {
        return untrailingslashit($configured);
    }

    $env = getenv('AWROADSIDE_RENDER_BASE_URL');
    return is_string($env) && $env !== '' ? untrailingslashit($env) : '';
}

function awroadside_fire_page_map() {
    return apply_filters('awroadside_fire_page_map', [
        'home' => [
            'slug' => 'awroadside',
            'path' => '/awroadside/',
        ],
        'customer' => [
            'slug' => 'awroadside-2',
            'path' => '/awroadside-2/',
        ],
        'subscriber' => [
            'slug' => 'awroadside-subs',
            'path' => '/awroadside-subs/',
        ],
        'provider' => [
            'slug' => 'awroadside-pro',
            'path' => '/awroadside-pro/',
        ],
        'admin' => [
            'slug' => 'admin',
            'path' => '/admin/',
        ],
        'security' => [
            'slug' => 'awroadside-security',
            'path' => '/awroadside/#security',
        ],
    ]);
}

function awroadside_fire_page_urls() {
    $urls = [];

    foreach (awroadside_fire_page_map() as $route => $config) {
        $path = isset($config['path']) ? (string) $config['path'] : '/';
        if (strpos($path, '#') !== false) {
            $parts = explode('#', $path, 2);
            $urls[$route] = home_url($parts[0]) . '#' . $parts[1];
            continue;
        }
        $urls[$route] = home_url($path);
    }

    return $urls;
}

function awroadside_fire_page_url($route) {
    $urls = awroadside_fire_page_urls();
    return $urls[$route] ?? home_url('/');
}

function awroadside_fire_button_targets() {
    return [
        'home' => awroadside_fire_page_url('home'),
        'continueAsGuest' => awroadside_fire_page_url('customer'),
        'customerPage' => awroadside_fire_page_url('customer'),
        'subscribe' => awroadside_fire_page_url('subscriber'),
        'subscriberPage' => awroadside_fire_page_url('subscriber'),
        'becomeProvider' => awroadside_fire_page_url('provider'),
        'providerPage' => awroadside_fire_page_url('provider'),
        'adminPage' => awroadside_fire_page_url('admin'),
        'securityPage' => awroadside_fire_page_url('security'),
    ];
}

function awroadside_fire_route_aliases() {
    return [
        '/business/' => 'home',
        '/business/customer/' => 'customer',
        '/business/provider/' => 'provider',
        '/business/subscriber/' => 'subscriber',
        '/business/admin/' => 'admin',
        '/customer/' => 'customer',
        '/subscriber/' => 'subscriber',
        '/provider/' => 'provider',
        '/member/' => 'subscriber',
        '/home/' => 'home',
        '/awroadside-home/' => 'home',
        '/awroadside-customer/' => 'customer',
        '/awroadside-provider/' => 'provider',
        '/awroadside-subscriber/' => 'subscriber',
        '/awroadside-admin/' => 'admin',
    ];
}

function awroadside_fire_current_route() {
    $match = awroadside_fire_match_route_request([
        'path' => awroadside_fire_current_request_path(),
    ]);

    return $match ? $match['route'] : 'home';
}

function awroadside_fire_match_route_request(array $params) {
    $page_map = awroadside_fire_page_map();
    $page_urls = awroadside_fire_page_urls();

    $intent = isset($params['intent']) ? awroadside_fire_normalize_token($params['intent']) : '';
    if ($intent === 'subscribe') {
        return [
            'route' => 'subscriber',
            'targetUrl' => $page_urls['subscriber'],
            'matchedBy' => 'intent',
        ];
    }

    foreach (['route', 'screen', 'slug'] as $key) {
        if (empty($params[$key])) {
            continue;
        }

        $candidate = awroadside_fire_normalize_token($params[$key]);
        if (isset($page_urls[$candidate])) {
            return [
                'route' => $candidate,
                'targetUrl' => $page_urls[$candidate],
                'matchedBy' => $key,
            ];
        }

        foreach ($page_map as $route => $config) {
            $slug = awroadside_fire_normalize_token($config['slug'] ?? '');
            if ($slug === $candidate) {
                return [
                    'route' => $route,
                    'targetUrl' => $page_urls[$route],
                    'matchedBy' => $key,
                ];
            }
        }
    }

    if (!empty($params['path'])) {
        $path = awroadside_fire_normalize_path($params['path']);
        $aliases = awroadside_fire_route_aliases();

        if (isset($aliases[$path])) {
            $route = $aliases[$path];
            return [
                'route' => $route,
                'targetUrl' => $page_urls[$route],
                'matchedBy' => 'path-alias',
            ];
        }

        foreach ($page_map as $route => $config) {
            $route_path = awroadside_fire_normalize_path($config['path'] ?? '/');
            if ($route_path === $path) {
                return [
                    'route' => $route,
                    'targetUrl' => $page_urls[$route],
                    'matchedBy' => 'path',
                ];
            }
        }

        if (is_404()) {
            $segment = awroadside_fire_normalize_token(basename(trim($path, '/')));
            if ($segment !== '') {
                foreach ($page_map as $route => $config) {
                    $slug = awroadside_fire_normalize_token($config['slug'] ?? '');
                    if ($slug === $segment || $route === $segment) {
                        return [
                            'route' => $route,
                            'targetUrl' => $page_urls[$route],
                            'matchedBy' => '404-segment',
                        ];
                    }
                }
            }
        }
    }

    return null;
}

function awroadside_fire_handle_route_fallback() {
    if (is_admin() || wp_doing_ajax() || (defined('REST_REQUEST') && REST_REQUEST)) {
        return;
    }

    $match = awroadside_fire_match_route_request([
        'path' => awroadside_fire_current_request_path(),
        'screen' => isset($_GET['screen']) ? wp_unslash($_GET['screen']) : '',
        'route' => isset($_GET['aw_route']) ? wp_unslash($_GET['aw_route']) : '',
        'intent' => isset($_GET['intent']) ? wp_unslash($_GET['intent']) : '',
    ]);

    if (!$match) {
        return;
    }

    $current_path = awroadside_fire_normalize_path(awroadside_fire_current_request_path());
    $target_path = awroadside_fire_normalize_path(wp_parse_url($match['targetUrl'], PHP_URL_PATH) ?: '/');

    if ($current_path === $target_path && !is_404()) {
        return;
    }

    wp_safe_redirect($match['targetUrl'], 302, 'AW Roadside Fire');
    exit;
}

function awroadside_fire_current_request_path() {
    $request_uri = isset($_SERVER['REQUEST_URI']) ? wp_unslash($_SERVER['REQUEST_URI']) : '/';
    $path = wp_parse_url($request_uri, PHP_URL_PATH);
    return is_string($path) && $path !== '' ? $path : '/';
}

function awroadside_fire_normalize_path($path) {
    $value = is_string($path) ? $path : '/';
    $value = wp_parse_url($value, PHP_URL_PATH) ?: $value;
    $value = '/' . trim($value, '/');
    $value = preg_replace('#/+#', '/', $value);

    return $value === '/' ? $value : $value . '/';
}

function awroadside_fire_normalize_token($value) {
    if (!is_string($value)) {
        return '';
    }

    $value = sanitize_key($value);
    return str_replace('_', '-', $value);
}
