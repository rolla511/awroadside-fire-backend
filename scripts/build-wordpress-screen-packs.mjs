import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const outputRoot = path.join(projectRoot, "out", "wordpress", "screen-packs");
const webRoot = path.join(projectRoot, "web");

const screens = [
  { id: "home", title: "Home" },
  { id: "customer", title: "Customer" },
  { id: "provider", title: "Provider" },
  { id: "admin", title: "Admin" },
  { id: "security", title: "Security" }
];

const html = await fs.readFile(path.join(webRoot, "index.html"), "utf8");
const bodyMatch = html.match(/<body>([\s\S]*?)<\/body>/i);
if (!bodyMatch) {
  throw new Error("Unable to extract app markup from web/index.html.");
}

const bodyContent = bodyMatch[1]
  .replace(/\s*<script src="app\.js"><\/script>\s*/i, "\n")
  .replaceAll('src="assets/roadside-home.png"', 'src="<?php echo esc_url(plugin_dir_url(__FILE__) . \'assets/images/roadside-home.png\'); ?>"')
  .replaceAll('src="assets/roadside-subscriber.png"', 'src="<?php echo esc_url(plugin_dir_url(__FILE__) . \'assets/images/roadside-subscriber.png\'); ?>"');

await fs.rm(outputRoot, { recursive: true, force: true });
await fs.mkdir(outputRoot, { recursive: true });

for (const screen of screens) {
  const slug = `awroadside-fire-${screen.id}`;
  const prefix = slug.replaceAll("-", "_");
  const pluginDir = path.join(outputRoot, slug);
  const assetsDir = path.join(pluginDir, "assets");
  const imagesDir = path.join(assetsDir, "images");
  const templatesDir = path.join(pluginDir, "templates");
  const zipPath = path.join(outputRoot, `${slug}.zip`);

  await fs.mkdir(imagesDir, { recursive: true });
  await fs.mkdir(templatesDir, { recursive: true });

  await Promise.all([
    fs.copyFile(path.join(webRoot, "app.js"), path.join(assetsDir, "fire-app.js")),
    fs.copyFile(path.join(webRoot, "styles.css"), path.join(assetsDir, "fire-styles.css")),
    fs.copyFile(path.join(webRoot, "assets", "roadside-home.png"), path.join(imagesDir, "roadside-home.png")),
    fs.copyFile(path.join(webRoot, "assets", "roadside-subscriber.png"), path.join(imagesDir, "roadside-subscriber.png")),
    fs.writeFile(path.join(templatesDir, "fire-ui.php"), `${bodyContent.trim()}\n`),
    fs.writeFile(path.join(pluginDir, "README.md"), buildReadme(slug, screen)),
    fs.writeFile(path.join(pluginDir, `${slug}.php`), buildPluginPhp({ slug, prefix, screen }))
  ]);

  await execFileAsync("ditto", ["-c", "-k", "--norsrc", "--keepParent", pluginDir, zipPath]);
}

console.log(`WordPress screen packs prepared in ${outputRoot}`);

function buildReadme(slug, screen) {
  return [
    `${screen.title} screen WordPress package.`,
    "",
    `Plugin folder: ${slug}`,
    `Shortcode: [${slug.replaceAll("-", "_")}]`,
    `Forced screen: ${screen.id}`,
    "",
    "Set the Render base URL in the plugin settings page after activation."
  ].join("\n");
}

function buildPluginPhp({ slug, prefix, screen }) {
  const shortcode = slug.replaceAll("-", "_");
  const optionName = `${prefix}_render_base_url`;
  const menuSlug = slug;
  const namespace = `${slug}/v1`;
  const scriptHandle = `${slug}-app`;
  const styleHandle = `${slug}-styles`;
  const fontsHandle = `${slug}-fonts`;
  const settingsGroup = prefix;

  return `<?php
/**
 * Plugin Name: AW Roadside Fire ${screen.title}
 * Description: WordPress delivery layer for the AW Roadside ${screen.title} screen with REST proxy routes to the Render backend.
 * Version: 1.0.0
 */

if (!defined('ABSPATH')) {
    exit;
}

${prefix}_bootstrap();

function ${prefix}_bootstrap() {
    add_action('admin_init', '${prefix}_register_settings');
    add_action('admin_menu', '${prefix}_register_settings_page');
    add_action('rest_api_init', '${prefix}_register_rest_routes');
    add_shortcode('${shortcode}', '${prefix}_render_shortcode');
}

function ${prefix}_register_settings() {
    register_setting('${settingsGroup}', '${optionName}', [
        'sanitize_callback' => 'esc_url_raw',
        'default' => '',
    ]);
}

function ${prefix}_register_settings_page() {
    add_options_page(
        'AW Roadside Fire ${screen.title}',
        'AW Fire ${screen.title}',
        'manage_options',
        '${menuSlug}',
        '${prefix}_render_settings_page'
    );
}

function ${prefix}_render_settings_page() {
    ?>
    <div class="wrap">
        <h1>AW Roadside Fire ${screen.title}</h1>
        <form method="post" action="options.php">
            <?php settings_fields('${settingsGroup}'); ?>
            <table class="form-table" role="presentation">
                <tr>
                    <th scope="row"><label for="${optionName}">Render Base URL</label></th>
                    <td>
                        <input
                            type="url"
                            class="regular-text"
                            id="${optionName}"
                            name="${optionName}"
                            value="<?php echo esc_attr(${prefix}_render_base_url()); ?>"
                            placeholder="https://your-render-service.onrender.com"
                        />
                        <p class="description">This should be the Render service root. The plugin will proxy to its <code>/api/*</code> routes.</p>
                    </td>
                </tr>
            </table>
            <?php submit_button('Save Settings'); ?>
        </form>
        <p>Use shortcode <code>[${shortcode}]</code> on the page that should render the ${screen.title} screen.</p>
    </div>
    <?php
}

function ${prefix}_render_shortcode() {
    ${prefix}_enqueue_assets();
    ob_start();
    include plugin_dir_path(__FILE__) . 'templates/fire-ui.php';
    return ob_get_clean();
}

function ${prefix}_enqueue_assets() {
    wp_enqueue_style(
        '${fontsHandle}',
        'https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=Sora:wght@400;600;700;800&display=swap',
        [],
        null
    );
    wp_enqueue_style(
        '${styleHandle}',
        plugin_dir_url(__FILE__) . 'assets/fire-styles.css',
        ['${fontsHandle}'],
        filemtime(plugin_dir_path(__FILE__) . 'assets/fire-styles.css')
    );
    wp_enqueue_script(
        '${scriptHandle}',
        plugin_dir_url(__FILE__) . 'assets/fire-app.js',
        [],
        filemtime(plugin_dir_path(__FILE__) . 'assets/fire-app.js'),
        true
    );
    wp_add_inline_script(
        '${scriptHandle}',
        'window.AWRoadsideConfig = ' . wp_json_encode(${prefix}_frontend_config()) . '; if (!window.location.hash) { window.location.hash = "#${screen.id}"; }',
        'before'
    );
}

function ${prefix}_register_rest_routes() {
    register_rest_route('${namespace}', '/config/frontend', [
        'methods' => 'GET',
        'callback' => '${prefix}_rest_frontend_config',
        'permission_callback' => '__return_true',
    ]);

    register_rest_route('${namespace}', '/proxy/(?P<path>.+)', [
        'methods' => ['GET', 'POST'],
        'callback' => '${prefix}_rest_proxy',
        'permission_callback' => '__return_true',
        'args' => [
            'path' => [
                'required' => true,
            ],
        ],
    ]);
}

function ${prefix}_rest_frontend_config() {
    return rest_ensure_response(${prefix}_frontend_config());
}

function ${prefix}_rest_proxy(WP_REST_Request $request) {
    $base_url = ${prefix}_render_base_url();
    if (!$base_url) {
        return new WP_Error('${prefix}_missing_base_url', 'Set the Render base URL in WordPress settings first.', ['status' => 500]);
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

function ${prefix}_frontend_config() {
    $remote_config = ${prefix}_fetch_remote_json('/api/aw-roadside/frontend-config');
    $proxy_root = rest_url('${namespace}/proxy');

    return [
        'uiBaseUrl' => home_url('/'),
        'apiBaseUrl' => rest_url('${namespace}/proxy/aw-roadside'),
        'rawApiBaseUrl' => $proxy_root,
        'adminApiBaseUrl' => rest_url('${namespace}/proxy/admin'),
        'bootstrapHealthUrl' => rest_url('${namespace}/proxy/aw-roadside/health'),
        'bootstrapFrontendConfigUrl' => rest_url('${namespace}/config/frontend'),
        'bootstrapManifestUrl' => rest_url('${namespace}/proxy/compat/manifest'),
        'bootstrapAcknowledgeUrl' => rest_url('${namespace}/proxy/compat/acknowledge'),
        'frontendConfig' => [
            'apiBaseUrl' => rest_url('${namespace}/proxy/aw-roadside'),
            'rawApiBaseUrl' => $proxy_root,
            'adminApiBaseUrl' => rest_url('${namespace}/proxy/admin'),
            'uiBaseUrl' => home_url('/'),
            'priorityServicePrice' => isset($remote_config['priorityServicePrice']) ? $remote_config['priorityServicePrice'] : 25,
            'serviceBasePrice' => isset($remote_config['serviceBasePrice']) ? $remote_config['serviceBasePrice'] : 55,
            'paypalEnabled' => !empty($remote_config['paypalEnabled']),
            'securityLayer' => isset($remote_config['securityLayer']) ? $remote_config['securityLayer'] : 'aw-roadside-security',
            'forcedScreen' => '${screen.id}',
        ],
    ];
}

function ${prefix}_fetch_remote_json($path) {
    $base_url = ${prefix}_render_base_url();
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

function ${prefix}_render_base_url() {
    $configured = get_option('${optionName}', '');
    if (is_string($configured) && $configured !== '') {
        return untrailingslashit($configured);
    }

    $env = getenv('AWROADSIDE_RENDER_BASE_URL');
    return is_string($env) && $env !== '' ? untrailingslashit($env) : '';
}
`;
}
