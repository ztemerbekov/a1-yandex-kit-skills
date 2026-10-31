// Offline process fixture: exercises the production runtime with a fixed API.
if (process.env.YANDEX_KIT_BASE_URL || process.env.YANDEX_KIT_TOKEN)
    throw new Error('Inherited credentials or URL reached project smoke');
globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith('https://api.kit.yandex.net/') || options.headers.Authorization !== 'Bearer private-one')
        throw new Error('Unexpected runtime request');
    return new Response(JSON.stringify({ id: 'one', slug: 'offline-store', b2c_url: 'https://offline.example' }), { status: 200, headers: { 'content-type': 'application/json' } });
};
