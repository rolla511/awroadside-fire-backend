<?php
/**
 * Plugin Name: firewp1subscriber
 * Description: AW Roadside WordPress-native subscriber screen with Render backend proxy routes.
 * Version: 1.0.0
 */

if (!defined('ABSPATH')) {
    exit;
}

define('FIREWP1SUBSCRIBER_PATH', plugin_dir_path(__FILE__));
define('FIREWP1SUBSCRIBER_URL', plugin_dir_url(__FILE__));

add_action('admin_init', 'firewp1subscriber_register_settings');
add_action('admin_menu', 'firewp1subscriber_register_settings_page');
add_action('rest_api_init', 'firewp1subscriber_register_rest_routes');
add_shortcode('firewp1subscriber', 'firewp1subscriber_render_shortcode');

function firewp1subscriber_register_settings() {
    register_setting('firewp1subscriber', 'firewp1subscriber_render_base_url', [
        'sanitize_callback' => 'esc_url_raw',
        'default' => '',
    ]);
}

function firewp1subscriber_register_settings_page() {
    add_options_page(
        'firewp1subscriber',
        'firewp1subscriber',
        'manage_options',
        'firewp1subscriber',
        'firewp1subscriber_render_settings_page'
    );
}

function firewp1subscriber_render_settings_page() {
    ?>
    <div class="wrap">
        <h1>firewp1subscriber</h1>
        <form method="post" action="options.php">
            <?php settings_fields('firewp1subscriber'); ?>
            <table class="form-table" role="presentation">
                <tr>
                    <th scope="row"><label for="firewp1subscriber_render_base_url">Render Base URL</label></th>
                    <td>
                        <input
                            type="url"
                            class="regular-text"
                            id="firewp1subscriber_render_base_url"
                            name="firewp1subscriber_render_base_url"
                            value="<?php echo esc_attr(firewp1subscriber_render_base_url()); ?>"
                            placeholder="https://your-render-service.onrender.com"
                        />
                        <p class="description">This should be the Render service root. The plugin will proxy to its <code>/api/*</code> routes.</p>
                    </td>
                </tr>
            </table>
            <?php submit_button('Save Settings'); ?>
        </form>
        <p>Use shortcode <code>[firewp1subscriber]</code> on the page that should render the subscriber screen.</p>
    </div>
    <?php
}

function firewp1subscriber_render_shortcode() {
    firewp1subscriber_enqueue_assets();
    ob_start();
    include FIREWP1SUBSCRIBER_PATH . 'templates/subscriber-screen.php';
    return ob_get_clean();
}

function firewp1subscriber_enqueue_assets() {
    wp_enqueue_style(
        'firewp1subscriber-fonts',
        'https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=Sora:wght@400;600;700;800&display=swap',
        [],
        null
    );
    wp_enqueue_style(
        'firewp1subscriber-styles',
        FIREWP1SUBSCRIBER_URL . 'assets/firewp1subscriber.css',
        ['firewp1subscriber-fonts'],
        filemtime(FIREWP1SUBSCRIBER_PATH . 'assets/firewp1subscriber.css')
    );
    wp_enqueue_script(
        'firewp1subscriber-script',
        FIREWP1SUBSCRIBER_URL . 'assets/firewp1subscriber.js',
        [],
        filemtime(FIREWP1SUBSCRIBER_PATH . 'assets/firewp1subscriber.js'),
        true
    );
    wp_add_inline_script(
        'firewp1subscriber-script',
        'window.FireWp1SubscriberConfig = ' . wp_json_encode(firewp1subscriber_frontend_config()) . ';',
        'before'
    );
}

function firewp1subscriber_register_rest_routes() {
    register_rest_route('firewp1subscriber/v1', '/config/frontend', [
        'methods' => 'GET',
        'callback' => 'firewp1subscriber_rest_frontend_config',
        'permission_callback' => '__return_true',
    ]);

    register_rest_route('firewp1subscriber/v1', '/proxy/(?P<path>.+)', [
        'methods' => ['GET', 'POST'],
        'callback' => 'firewp1subscriber_rest_proxy',
        'permission_callback' => '__return_true',
        'args' => [
            'path' => [
                'required' => true,
            ],
        ],
    ]);
}

function firewp1subscriber_rest_frontend_config() {
    return rest_ensure_response(firewp1subscriber_frontend_config());
}

function firewp1subscriber_rest_proxy(WP_REST_Request $request) {
    $base_url = firewp1subscriber_render_base_url();
    if (!$base_url) {
        return new WP_Error('firewp1subscriber_missing_base_url', 'Set the Render base URL in WordPress settings first.', ['status' => 500]);
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

function firewp1subscriber_frontend_config() {
    $remote_config = firewp1subscriber_fetch_remote_json('/api/aw-roadside/frontend-config');

    return [
        'uiBaseUrl' => home_url('/'),
        'apiBaseUrl' => rest_url('firewp1subscriber/v1/proxy/aw-roadside'),
        'rawApiBaseUrl' => rest_url('firewp1subscriber/v1/proxy'),
        'authApiBaseUrl' => rest_url('firewp1subscriber/v1/proxy'),
        'bootstrapHealthUrl' => rest_url('firewp1subscriber/v1/proxy/aw-roadside/health'),
        'bootstrapFrontendConfigUrl' => rest_url('firewp1subscriber/v1/config/frontend'),
        'subscriptionStartUrl' => rest_url('firewp1subscriber/v1/proxy/subscriptions/start'),
        'subscriptionStatusUrl' => rest_url('firewp1subscriber/v1/proxy/subscriptions/status'),
        'requestHistoryUrl' => rest_url('firewp1subscriber/v1/proxy/requests/history'),
        'homePageUrl' => home_url('/awroadside/'),
        'customerPageUrl' => home_url('/awroadside-2/'),
        'providerPageUrl' => home_url('/awroadside-pro/'),
        'frontendConfig' => [
            'subscriberServicePrice' => isset($remote_config['subscriberServicePrice']) ? $remote_config['subscriberServicePrice'] : 40,
            'assignmentFee' => isset($remote_config['assignmentFee']) ? $remote_config['assignmentFee'] : 2,
        ],
    ];
}

function firewp1subscriber_fetch_remote_json($path) {
    $base_url = firewp1subscriber_render_base_url();
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

function firewp1subscriber_render_base_url() {
    $configured = get_option('firewp1subscriber_render_base_url', '');
    if (is_string($configured) && $configured !== '') {
        return untrailingslashit($configured);
    }

    $env = getenv('AWROADSIDE_RENDER_BASE_URL');
    return is_string($env) && $env !== '' ? untrailingslashit($env) : '';
}
