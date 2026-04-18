<?php
/**
 * Plugin Name: firewp1provider
 * Description: AW Roadside WordPress-native provider screen with Render backend proxy routes.
 * Version: 1.0.0
 */

if (!defined('ABSPATH')) {
    exit;
}

define('FIREWP1PROVIDER_PATH', plugin_dir_path(__FILE__));
define('FIREWP1PROVIDER_URL', plugin_dir_url(__FILE__));

add_action('admin_init', 'firewp1provider_register_settings');
add_action('admin_menu', 'firewp1provider_register_settings_page');
add_action('rest_api_init', 'firewp1provider_register_rest_routes');
add_shortcode('firewp1provider', 'firewp1provider_render_shortcode');

function firewp1provider_register_settings() {
    register_setting('firewp1provider', 'firewp1provider_render_base_url', [
        'sanitize_callback' => 'esc_url_raw',
        'default' => '',
    ]);
}

function firewp1provider_register_settings_page() {
    add_options_page(
        'firewp1provider',
        'firewp1provider',
        'manage_options',
        'firewp1provider',
        'firewp1provider_render_settings_page'
    );
}

function firewp1provider_render_settings_page() {
    ?>
    <div class="wrap">
        <h1>firewp1provider</h1>
        <form method="post" action="options.php">
            <?php settings_fields('firewp1provider'); ?>
            <table class="form-table" role="presentation">
                <tr>
                    <th scope="row"><label for="firewp1provider_render_base_url">Render Base URL</label></th>
                    <td>
                        <input
                            type="url"
                            class="regular-text"
                            id="firewp1provider_render_base_url"
                            name="firewp1provider_render_base_url"
                            value="<?php echo esc_attr(firewp1provider_render_base_url()); ?>"
                            placeholder="https://your-render-service.onrender.com"
                        />
                        <p class="description">This should be the Render service root. The plugin will proxy to its <code>/api/*</code> routes.</p>
                    </td>
                </tr>
            </table>
            <?php submit_button('Save Settings'); ?>
        </form>
        <p>Use shortcode <code>[firewp1provider]</code> on the page that should render the provider screen.</p>
    </div>
    <?php
}

function firewp1provider_render_shortcode() {
    firewp1provider_enqueue_assets();
    ob_start();
    include FIREWP1PROVIDER_PATH . 'templates/provider-screen.php';
    return ob_get_clean();
}

function firewp1provider_enqueue_assets() {
    wp_enqueue_style(
        'firewp1provider-fonts',
        'https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=Sora:wght@400;600;700;800&display=swap',
        [],
        null
    );
    wp_enqueue_style(
        'firewp1provider-styles',
        FIREWP1PROVIDER_URL . 'assets/firewp1provider.css',
        ['firewp1provider-fonts'],
        filemtime(FIREWP1PROVIDER_PATH . 'assets/firewp1provider.css')
    );
    wp_enqueue_script(
        'firewp1provider-script',
        FIREWP1PROVIDER_URL . 'assets/firewp1provider.js',
        [],
        filemtime(FIREWP1PROVIDER_PATH . 'assets/firewp1provider.js'),
        true
    );
    wp_add_inline_script(
        'firewp1provider-script',
        'window.FireWp1ProviderConfig = ' . wp_json_encode(firewp1provider_frontend_config()) . ';',
        'before'
    );
}

function firewp1provider_register_rest_routes() {
    register_rest_route('firewp1provider/v1', '/config/frontend', [
        'methods' => 'GET',
        'callback' => 'firewp1provider_rest_frontend_config',
        'permission_callback' => '__return_true',
    ]);

    register_rest_route('firewp1provider/v1', '/proxy/(?P<path>.+)', [
        'methods' => ['GET', 'POST'],
        'callback' => 'firewp1provider_rest_proxy',
        'permission_callback' => '__return_true',
        'args' => [
            'path' => [
                'required' => true,
            ],
        ],
    ]);
}

function firewp1provider_rest_frontend_config() {
    return rest_ensure_response(firewp1provider_frontend_config());
}

function firewp1provider_rest_proxy(WP_REST_Request $request) {
    $base_url = firewp1provider_render_base_url();
    if (!$base_url) {
        return new WP_Error('firewp1provider_missing_base_url', 'Set the Render base URL in WordPress settings first.', ['status' => 500]);
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

function firewp1provider_frontend_config() {
    $remote_config = firewp1provider_fetch_remote_json('/api/aw-roadside/frontend-config');

    return [
        'uiBaseUrl' => home_url('/'),
        'apiBaseUrl' => rest_url('firewp1provider/v1/proxy/aw-roadside'),
        'rawApiBaseUrl' => rest_url('firewp1provider/v1/proxy'),
        'authApiBaseUrl' => rest_url('firewp1provider/v1/proxy'),
        'bootstrapHealthUrl' => rest_url('firewp1provider/v1/proxy/aw-roadside/health'),
        'bootstrapFrontendConfigUrl' => rest_url('firewp1provider/v1/config/frontend'),
        'providerLoginUrl' => rest_url('firewp1provider/v1/proxy/providers/login'),
        'providerJobsUrl' => rest_url('firewp1provider/v1/proxy/providers/jobs'),
        'providerAcceptUrl' => rest_url('firewp1provider/v1/proxy/providers/jobs/accept'),
        'providerFinishUrl' => rest_url('firewp1provider/v1/proxy/providers/jobs/finish'),
        'homePageUrl' => home_url('/awroadside/'),
        'customerPageUrl' => home_url('/awroadside-2/'),
        'frontendConfig' => [
            'priorityServicePrice' => isset($remote_config['priorityServicePrice']) ? $remote_config['priorityServicePrice'] : 25,
            'guestServicePrice' => isset($remote_config['guestServicePrice']) ? $remote_config['guestServicePrice'] : 55,
            'subscriberServicePrice' => isset($remote_config['subscriberServicePrice']) ? $remote_config['subscriberServicePrice'] : 40,
            'assignmentFee' => isset($remote_config['assignmentFee']) ? $remote_config['assignmentFee'] : 2,
            'guestDispatchFee' => isset($remote_config['guestDispatchFee']) ? $remote_config['guestDispatchFee'] : 10,
            'subscriberDispatchFee' => isset($remote_config['subscriberDispatchFee']) ? $remote_config['subscriberDispatchFee'] : 0,
            'paypalEnabled' => !empty($remote_config['paypalEnabled']),
        ],
    ];
}

function firewp1provider_fetch_remote_json($path) {
    $base_url = firewp1provider_render_base_url();
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

function firewp1provider_render_base_url() {
    $configured = get_option('firewp1provider_render_base_url', '');
    if (is_string($configured) && $configured !== '') {
        return untrailingslashit($configured);
    }

    $env = getenv('AWROADSIDE_RENDER_BASE_URL');
    return is_string($env) && $env !== '' ? untrailingslashit($env) : '';
}
