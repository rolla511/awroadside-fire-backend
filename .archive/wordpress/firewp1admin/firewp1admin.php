<?php
/**
 * Plugin Name: firewp1admin
 * Description: AW Roadside WordPress-native admin screen with Render backend proxy routes.
 * Version: 1.0.0
 */

if (!defined('ABSPATH')) {
    exit;
}

define('FIREWP1ADMIN_PATH', plugin_dir_path(__FILE__));
define('FIREWP1ADMIN_URL', plugin_dir_url(__FILE__));

add_action('admin_init', 'firewp1admin_register_settings');
add_action('admin_menu', 'firewp1admin_register_settings_page');
add_action('rest_api_init', 'firewp1admin_register_rest_routes');
add_shortcode('firewp1admin', 'firewp1admin_render_shortcode');

function firewp1admin_register_settings() {
    register_setting('firewp1admin', 'firewp1admin_render_base_url', [
        'sanitize_callback' => 'esc_url_raw',
        'default' => '',
    ]);
}

function firewp1admin_register_settings_page() {
    add_options_page(
        'firewp1admin',
        'firewp1admin',
        'manage_options',
        'firewp1admin',
        'firewp1admin_render_settings_page'
    );
}

function firewp1admin_render_settings_page() {
    ?>
    <div class="wrap">
        <h1>firewp1admin</h1>
        <form method="post" action="options.php">
            <?php settings_fields('firewp1admin'); ?>
            <table class="form-table" role="presentation">
                <tr>
                    <th scope="row"><label for="firewp1admin_render_base_url">Render Base URL</label></th>
                    <td>
                        <input
                            type="url"
                            class="regular-text"
                            id="firewp1admin_render_base_url"
                            name="firewp1admin_render_base_url"
                            value="<?php echo esc_attr(firewp1admin_render_base_url()); ?>"
                            placeholder="https://your-render-service.onrender.com"
                        />
                        <p class="description">This should be the Render service root. The plugin will proxy to its <code>/api/*</code> routes.</p>
                    </td>
                </tr>
            </table>
            <?php submit_button('Save Settings'); ?>
        </form>
        <p>Use shortcode <code>[firewp1admin]</code> on the page that should render the admin screen.</p>
    </div>
    <?php
}

function firewp1admin_render_shortcode() {
    firewp1admin_enqueue_assets();
    ob_start();
    include FIREWP1ADMIN_PATH . 'templates/admin-screen.php';
    return ob_get_clean();
}

function firewp1admin_enqueue_assets() {
    wp_enqueue_style(
        'firewp1admin-fonts',
        'https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=Sora:wght@400;600;700;800&display=swap',
        [],
        null
    );
    wp_enqueue_script(
        'firewp1admin-script',
        FIREWP1ADMIN_URL . 'assets/firewp1admin.js',
        [],
        filemtime(FIREWP1ADMIN_PATH . 'assets/firewp1admin.js'),
        true
    );
    wp_add_inline_script(
        'firewp1admin-script',
        'window.FireWp1AdminConfig = ' . wp_json_encode(firewp1admin_frontend_config()) . ';',
        'before'
    );
}

function firewp1admin_register_rest_routes() {
    register_rest_route('firewp1admin/v1', '/config/frontend', [
        'methods' => 'GET',
        'callback' => 'firewp1admin_rest_frontend_config',
        'permission_callback' => '__return_true',
    ]);

    register_rest_route('firewp1admin/v1', '/proxy/(?P<path>.+)', [
        'methods' => ['GET', 'POST'],
        'callback' => 'firewp1admin_rest_proxy',
        'permission_callback' => '__return_true',
        'args' => [
            'path' => [
                'required' => true,
            ],
        ],
    ]);
}

function firewp1admin_rest_frontend_config() {
    return rest_ensure_response(firewp1admin_frontend_config());
}

function firewp1admin_rest_proxy(WP_REST_Request $request) {
    $base_url = firewp1admin_render_base_url();
    if (!$base_url) {
        return new WP_Error('firewp1admin_missing_base_url', 'Set the Render base URL in WordPress settings first.', ['status' => 500]);
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

function firewp1admin_frontend_config() {
    return [
        'uiBaseUrl' => home_url('/'),
        'authApiBaseUrl' => rest_url('firewp1admin/v1/proxy'),
        'bootstrapHealthUrl' => rest_url('firewp1admin/v1/proxy/aw-roadside/health'),
        'bootstrapFrontendConfigUrl' => rest_url('firewp1admin/v1/config/frontend'),
        'adminLoginUrl' => rest_url('firewp1admin/v1/proxy/admin/login'),
        'adminDashboardUrl' => rest_url('firewp1admin/v1/proxy/admin/dashboard'),
        'adminRequestsUrl' => rest_url('firewp1admin/v1/proxy/admin/requests'),
        'adminSubscribersUrl' => rest_url('firewp1admin/v1/proxy/admin/subscribers'),
        'homePageUrl' => home_url('/awroadside/'),
        'providerPageUrl' => home_url('/awroadside-pro/'),
        'subscriberPageUrl' => home_url('/awroadside-subs/'),
    ];
}

function firewp1admin_render_base_url() {
    $configured = get_option('firewp1admin_render_base_url', '');
    if (is_string($configured) && $configured !== '') {
        return untrailingslashit($configured);
    }

    $env = getenv('AWROADSIDE_RENDER_BASE_URL');
    return is_string($env) && $env !== '' ? untrailingslashit($env) : '';
}
