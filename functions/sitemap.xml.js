export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const baseUrl = url.origin;
    const pathname = url.pathname;
    
    try {
        // Get all video slugs
        const allVideoSlugs = await getAllVideoSlugs(env);
        
        // Handle different sitemap requests
        if (pathname === '/sitemap.xml' || pathname === '/') {
            return generateMainSitemap(allVideoSlugs, baseUrl);
        } else if (pathname.startsWith('/sitemap-')) {
            return generateIndividualSitemap(allVideoSlugs, baseUrl, pathname);
        } else if (pathname === '/sitemap-categories.xml') {
            return generateCategoriesSitemap(allVideoSlugs, baseUrl);
        } else if (pathname === '/sitemap-static.xml') {
            return generateStaticSitemap(baseUrl);
        }
        
        // If it's not a sitemap request, return 404
        return new Response('Not found', { status: 404 });
        
    } catch (error) {
        console.error('Sitemap generation error:', error);
        return new Response('Error generating sitemap', { status: 500 });
    }
}

function generateMainSitemap(allVideoSlugs, baseUrl) {
    const today = new Date().toISOString().split('T')[0];
    const MAX_URLS_PER_SITEMAP = 1000;
    
    // Count total URLs (static pages + homepage + categories + videos)
    const categories = [...new Set(allVideoSlugs.map(v => v.category).filter(Boolean))];
    const staticPages = ['/about', '/privacy', '/terms', '/contact'];
    const totalUrls = 1 + staticPages.length + categories.length + allVideoSlugs.length;
    
    console.log(`Total URLs: ${totalUrls}, Video slugs: ${allVideoSlugs.length}`);
    
    // If under limit, generate single sitemap
    if (totalUrls <= MAX_URLS_PER_SITEMAP) {
        return generateSingleSitemap(allVideoSlugs, baseUrl, today);
    }
    
    // If over limit, generate sitemap index
    return generateSitemapIndex(allVideoSlugs, baseUrl, today, MAX_URLS_PER_SITEMAP);
}

function generateSingleSitemap(allVideoSlugs, baseUrl, today) {
    const staticPages = [
        { url: '/', priority: '1.0', changefreq: 'daily' },
        { url: '/about', priority: '0.7', changefreq: 'monthly' },
        { url: '/privacy', priority: '0.3', changefreq: 'yearly' },
        { url: '/terms', priority: '0.3', changefreq: 'yearly' },
        { url: '/contact', priority: '0.5', changefreq: 'monthly' }
    ];
    
    let sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

    // Static pages including homepage
    staticPages.forEach(page => {
        sitemap += `
    <url>
        <loc>${baseUrl}${page.url}</loc>
        <lastmod>${today}</lastmod>
        <changefreq>${page.changefreq}</changefreq>
        <priority>${page.priority}</priority>
    </url>`;
    });

    // Category pages
    const categories = [...new Set(allVideoSlugs.map(v => v.category).filter(Boolean))];
    categories.forEach(category => {
        sitemap += `
    <url>
        <loc>${baseUrl}/?category=${category}</loc>
        <lastmod>${today}</lastmod>
        <changefreq>weekly</changefreq>
        <priority>0.8</priority>
    </url>`;
    });

    // Video pages
    allVideoSlugs.forEach(({ category, slug }) => {
        const videoUrl = `${baseUrl}/${category}/${slug}`;
        sitemap += `
    <url>
        <loc>${videoUrl}</loc>
        <lastmod>${today}</lastmod>
        <changefreq>monthly</changefreq>
        <priority>0.6</priority>
    </url>`;
    });

    sitemap += '\n</urlset>';
    
    return new Response(sitemap, {
        headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 'public, max-age=10800' // 3 hours
        }
    });
}

function generateSitemapIndex(allVideoSlugs, baseUrl, today, maxUrls) {
    const totalSitemaps = Math.ceil(allVideoSlugs.length / maxUrls);
    
    let sitemapIndex = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <sitemap>
        <loc>${baseUrl}/sitemap-static.xml</loc>
        <lastmod>${today}</lastmod>
    </sitemap>
    <sitemap>
        <loc>${baseUrl}/sitemap-categories.xml</loc>
        <lastmod>${today}</lastmod>
    </sitemap>`;
    
    for (let i = 1; i <= totalSitemaps; i++) {
        sitemapIndex += `
    <sitemap>
        <loc>${baseUrl}/sitemap-${i}.xml</loc>
        <lastmod>${today}</lastmod>
    </sitemap>`;
    }
    
    sitemapIndex += '\n</sitemapindex>';
    
    return new Response(sitemapIndex, {
        headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 'public, max-age=10800' // 3 hours
        }
    });
}

function generateIndividualSitemap(allVideoSlugs, baseUrl, pathname) {
    const today = new Date().toISOString().split('T')[0];
    const MAX_URLS_PER_SITEMAP = 1000;
    
    // Extract sitemap number from pathname
    const match = pathname.match(/sitemap-(\d+)\.xml/);
    if (!match) {
        return new Response('Invalid sitemap', { status: 404 });
    }
    
    const sitemapNumber = parseInt(match[1]);
    const startIndex = (sitemapNumber - 1) * MAX_URLS_PER_SITEMAP;
    const endIndex = startIndex + MAX_URLS_PER_SITEMAP;
    const videoSlugs = allVideoSlugs.slice(startIndex, endIndex);
    
    if (videoSlugs.length === 0) {
        return new Response('Sitemap not found', { status: 404 });
    }
    
    let sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;
    
    // Add video URLs for this chunk only
    videoSlugs.forEach(({ category, slug }) => {
        const videoUrl = `${baseUrl}/${category}/${slug}`;
        sitemap += `
    <url>
        <loc>${videoUrl}</loc>
        <lastmod>${today}</lastmod>
        <changefreq>monthly</changefreq>
        <priority>0.6</priority>
    </url>`;
    });
    
    sitemap += '\n</urlset>';
    
    return new Response(sitemap, {
        headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 'public, max-age=10800' // 3 hours
        }
    });
}

function generateCategoriesSitemap(allVideoSlugs, baseUrl) {
    const today = new Date().toISOString().split('T')[0];
    
    let sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url>
        <loc>${baseUrl}/</loc>
        <lastmod>${today}</lastmod>
        <changefreq>daily</changefreq>
        <priority>1.0</priority>
    </url>`;
    
    // Category pages only
    const categories = [...new Set(allVideoSlugs.map(v => v.category).filter(Boolean))];
    categories.forEach(category => {
        sitemap += `
    <url>
        <loc>${baseUrl}/?category=${category}</loc>
        <lastmod>${today}</lastmod>
        <changefreq>weekly</changefreq>
        <priority>0.8</priority>
    </url>`;
    });
    
    sitemap += '\n</urlset>';
    
    return new Response(sitemap, {
        headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 'public, max-age=10800' // 3 hours
        }
    });
}

function generateStaticSitemap(baseUrl) {
    const today = new Date().toISOString().split('T')[0];
    const staticPages = [
        { url: '/', priority: '1.0', changefreq: 'daily' },
        { url: '/about', priority: '0.7', changefreq: 'monthly' },
        { url: '/privacy', priority: '0.3', changefreq: 'yearly' },
        { url: '/terms', priority: '0.3', changefreq: 'yearly' },
        { url: '/contact', priority: '0.5', changefreq: 'monthly' }
    ];
    
    let sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;
    
    staticPages.forEach(page => {
        sitemap += `
    <url>
        <loc>${baseUrl}${page.url}</loc>
        <lastmod>${today}</lastmod>
        <changefreq>${page.changefreq}</changefreq>
        <priority>${page.priority}</priority>
    </url>`;
    });
    
    sitemap += '\n</urlset>';
    
    return new Response(sitemap, {
        headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 'public, max-age=10800' // 3 hours
        }
    });
}

async function getAllVideoSlugs(env) {
    const GITHUB_TOKEN = env.GITHUB_TOKEN;
    const GITHUB_USERNAME = "burnac321";
    const GITHUB_REPO = "Inyarwanda-Films";
    
    const categories = ['comedy', 'drama', 'music', 'action', 'documentary'];
    const allSlugs = [];

    for (const category of categories) {
        try {
            const categorySlugs = await getCategorySlugs(GITHUB_TOKEN, GITHUB_USERNAME, GITHUB_REPO, category);
            allSlugs.push(...categorySlugs.map(slug => ({ category, slug })));
        } catch (error) {
            console.warn(`Failed to load ${category} slugs:`, error.message);
        }
    }

    return allSlugs;
}

async function getCategorySlugs(token, username, repo, category) {
    try {
        const apiUrl = `https://api.github.com/repos/${username}/${repo}/contents/content/movies/${category}`;
        
        const response = await fetch(apiUrl, {
            headers: {
                'Authorization': `token ${token}`,
                'User-Agent': 'Inyarwanda-Films',
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        if (!response.ok) return [];

        const files = await response.json();
        const slugs = [];
        
        for (const file of files) {
            if (file.name.endsWith('.md') && file.type === 'file') {
                const slug = file.name.replace('.md', '');
                slugs.push(slug);
            }
        }
        
        return slugs;
    } catch (error) {
        console.error(`Error loading ${category} slugs:`, error);
        return [];
    }
}
