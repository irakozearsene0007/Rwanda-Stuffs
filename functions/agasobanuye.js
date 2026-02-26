// functions/agasobanuye.js
export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const pathname = url.pathname;
  const baseUrl = url.origin;
  
  // Only handle /agasobanuye routes
  if (!pathname.startsWith('/agasobanuye')) {
    return next();
  }
  
  try {
    // Load all translated videos from GitHub
    const allVideos = await loadTranslatedVideos(env);
    console.log(`Loaded ${allVideos.length} videos from GitHub`);
    
    // Apply search filters
    const searchQuery = url.searchParams.get('search') || '';
    const translatorFilter = url.searchParams.get('translator') || '';
    const typeFilter = url.searchParams.get('type') || '';
    
    let filteredVideos = allVideos;
    
    if (searchQuery) {
      filteredVideos = searchVideos(allVideos, searchQuery);
    }
    
    if (translatorFilter) {
      filteredVideos = filteredVideos.filter(v => 
        v.translatorSlug === translatorFilter.toLowerCase()
      );
    }
    
    if (typeFilter) {
      filteredVideos = filteredVideos.filter(v => 
        v.contentType === typeFilter.toUpperCase()
      );
    }
    
    // Get latest videos by type for homepage sections
    const latestByType = getLatestVideosByType(allVideos, 8);
    const translators = [...new Set(allVideos.map(v => v.translator))]
      .map(translator => ({
        name: translator,
        slug: generateSlug(translator),
        count: allVideos.filter(v => v.translator === translator).length
      }))
      .sort((a, b) => b.count - a.count);
    
    const moviesCount = allVideos.filter(v => v.contentType === 'MOVIE').length;
    const tvShowsCount = allVideos.filter(v => v.contentType === 'TV-SERIES').length;
    
    // Generate breadcrumbs
    const breadcrumbs = generateBreadcrumbs(searchQuery, translatorFilter, typeFilter, baseUrl);
    
    const html = generateHomepageHTML({
      searchQuery,
      translatorFilter,
      typeFilter,
      filteredVideos,
      allVideos,
      translators,
      latestByType,
      moviesCount,
      tvShowsCount,
      breadcrumbs,
      baseUrl
    });

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=UTF-8',
        'Cache-Control': 'public, max-age=7200, s-maxage=14400',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('Error generating agasobanuye page:', error);
    return new Response(generateErrorHTML(baseUrl), {
      headers: { 
        'Content-Type': 'text/html; charset=UTF-8',
        'Cache-Control': 'public, max-age=300'
      },
      status: 500
    });
  }
}

async function loadTranslatedVideos(env) {
  const GITHUB_TOKEN = env.GITHUB_TOKEN;
  const GITHUB_REPO = env.GITHUB_REPO;
  
  const allVideos = [];
  
  try {
    // Get directory contents from GitHub API
    const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/content/translated`;
    
    const response = await fetch(apiUrl, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'Rwanda-Cinema',
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (!response.ok) {
      console.error('GitHub API error:', response.status);
      return [];
    }

    const files = await response.json();
    console.log(`Found ${files.length} files in GitHub`);
    
    // Load each markdown file
    for (const file of files) {
      if (file.name.endsWith('.md') && file.type === 'file') {
        try {
          console.log(`Processing file: ${file.name}`);
          const videoData = await parseTranslatedVideo(file);
          if (videoData) {
            allVideos.push(videoData);
            console.log(`Successfully parsed: ${videoData.title}`);
          }
        } catch (error) {
          console.warn(`Failed to load ${file.name}:`, error.message);
        }
      }
    }
  } catch (error) {
    console.error(`Error loading translated videos:`, error);
  }

  // Sort all videos by date (newest first)
  return allVideos.sort((a, b) => new Date(b.dateAdded || b.uploadDate || 0) - new Date(a.dateAdded || a.uploadDate || 0));
}

async function parseTranslatedVideo(file) {
  try {
    // Parse filename: [Title][Content-Type][Translator].md
    const filenameMatch = file.name.match(/^\[([^\]]+)\]\[([^\]]+)\]\[([^\]]+)\]\.md$/);
    if (!filenameMatch) {
      console.log(`Filename doesn't match pattern: ${file.name}`);
      return null;
    }
    
    const [, title, contentType, translator] = filenameMatch;
    
    // Load file content
    const fileResponse = await fetch(file.download_url);
    if (!fileResponse.ok) {
      console.log(`Failed to fetch file content: ${file.name}`);
      return null;
    }
    
    const content = await fileResponse.text();
    
    // Parse YAML frontmatter
    const frontmatterData = parseYAMLFrontmatter(content);
    
    const videoData = {
      filename: file.name,
      title: frontmatterData.title || title.replace(/-/g, ' ').trim(),
      slug: frontmatterData.slug || generateSlug(title),
      contentType: frontmatterData.contentType || contentType.trim(),
      translator: frontmatterData.translator || translator.trim(),
      translatorSlug: generateSlug(frontmatterData.translator || translator),
      downloadUrl: file.download_url,
      htmlUrl: file.html_url,
      // Video metadata
      duration: frontmatterData.runtime || frontmatterData.duration || '',
      quality: frontmatterData.quality || frontmatterData.videoQuality || 'HD',
      uploadDate: frontmatterData.dateAdded || frontmatterData.uploadDate || new Date().toISOString(),
      poster: frontmatterData.posterUrl || frontmatterData.thumbnailUrl || '',
      videoUrl: frontmatterData.videoUrl || '',
      description: frontmatterData.description || frontmatterData.shortDescription || '',
      releaseYear: frontmatterData.releaseYear || '',
      genre: frontmatterData.genre || [],
      views: frontmatterData.views || 0,
      likes: frontmatterData.likes || 0,
      // Include all frontmatter data
      ...frontmatterData
    };
    
    // Ensure ISO duration exists
    if (videoData.duration && !videoData.isoDuration) {
      videoData.isoDuration = convertDurationToISO(videoData.duration);
    }
    
    // Format upload date for display
    if (videoData.uploadDate) {
      const date = new Date(videoData.uploadDate);
      videoData.formattedDate = formatDate(date);
      // Add short date for video card corners
      videoData.shortDate = formatShortDate(date);
    }
    
    // Format duration for display
    if (videoData.duration && videoData.duration !== 'Not specified') {
      videoData.formattedDuration = formatDurationForDisplay(videoData.duration);
    }
    
    return videoData;
    
  } catch (error) {
    console.warn(`Error parsing ${file.name}:`, error);
    return null;
  }
}

function parseYAMLFrontmatter(content) {
  const data = {};
  
  try {
    // Match YAML frontmatter between ---
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) return data;
    
    const frontmatter = frontmatterMatch[1];
    const lines = frontmatter.split('\n');
    
    for (const line of lines) {
      // Skip empty lines
      if (!line.trim()) continue;
      
      // Match key: value pattern
      const match = line.match(/^(\w+):\s*(.*)$/);
      if (match) {
        let [, key, value] = match;
        
        // Remove surrounding quotes if present
        value = value.replace(/^["'](.*)["']$/, '$1').trim();
        
        // Handle array values (lines starting with -)
        if (value === '' && lines.includes(line)) {
          const nextLineIndex = lines.indexOf(line) + 1;
          if (nextLineIndex < lines.length && lines[nextLineIndex].trim().startsWith('-')) {
            value = [];
            for (let i = nextLineIndex; i < lines.length; i++) {
              const arrayLine = lines[i].trim();
              if (arrayLine.startsWith('-')) {
                const arrayValue = arrayLine.substring(1).trim().replace(/^["'](.*)["']$/, '$1');
                value.push(arrayValue);
              } else {
                break;
              }
            }
          }
        }
        // Handle array values in square brackets
        else if (value.startsWith('[') && value.endsWith(']')) {
          try {
            // Simple JSON parsing for arrays
            value = JSON.parse(value);
          } catch (e) {
            // If JSON parsing fails, try to parse manually
            value = value.substring(1, value.length - 1)
              .split(',')
              .map(v => v.trim().replace(/^["'](.*)["']$/, '$1'))
              .filter(v => v);
          }
        }
        // Handle numbers
        else if (key === 'releaseYear' || key === 'views' || key === 'likes' || 
                 key === 'imdbRating' || key === 'imdbVotes' || key === 'rottenTomatoesScore' ||
                 key === 'metacriticScore' || key === 'ageRestriction' || key === 'seasonNumber' ||
                 key === 'totalSeasons' || key === 'episodeNumber' || key === 'episodeCount') {
          value = parseInt(value) || 0;
        }
        // Handle booleans
        else if (value === 'true' || value === 'false') {
          value = value === 'true';
        }
        // Handle multi-line strings (pipe syntax)
        else if (value === '|') {
          const nextLineIndex = lines.indexOf(line) + 1;
          value = '';
          for (let i = nextLineIndex; i < lines.length; i++) {
            const multiLine = lines[i];
            if (multiLine.startsWith('  ') || multiLine.startsWith('\t')) {
              value += multiLine.trim() + ' ';
            } else {
              break;
            }
          }
          value = value.trim();
        }
        
        data[key] = value;
      }
    }
  } catch (error) {
    console.warn('Error parsing YAML frontmatter:', error);
  }
  
  return data;
}

function convertDurationToISO(duration) {
  if (!duration || duration === 'Not specified') return 'PT0M';
  
  // Handle "1:30:00" format (hours:minutes:seconds)
  const hmsMatch = duration.match(/^(\d+):(\d+):(\d+)$/);
  if (hmsMatch) {
    const [, hours, minutes, seconds] = hmsMatch;
    return `PT${hours}H${minutes}M${seconds}S`;
  }
  
  // Handle "30:00" format (minutes:seconds)
  const msMatch = duration.match(/^(\d+):(\d+)$/);
  if (msMatch) {
    const [, minutes, seconds] = msMatch;
    return `PT${minutes}M${seconds}S`;
  }
  
  // Handle "90 minutes" format
  const minutesMatch = duration.match(/(\d+)\s*(?:min|minutes?)/i);
  if (minutesMatch) {
    const minutes = parseInt(minutesMatch[1]);
    return `PT${minutes}M`;
  }
  
  // Handle "2 hours" format
  const hoursMatch = duration.match(/(\d+)\s*(?:hr|hours?)/i);
  if (hoursMatch) {
    const hours = parseInt(hoursMatch[1]);
    return `PT${hours}H`;
  }
  
  // Handle "1h30m" format
  const hmMatch = duration.match(/(\d+)h\s*(\d+)m/i);
  if (hmMatch) {
    const [, hours, minutes] = hmMatch;
    return `PT${hours}H${minutes}M`;
  }
  
  return 'PT0M';
}

function formatDate(date) {
  const options = { year: 'numeric', month: 'long', day: 'numeric' };
  return date.toLocaleDateString('en-US', options);
}

function formatShortDate(date) {
  const now = new Date();
  const diffTime = Math.abs(now - date);
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) {
    return 'Today';
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    return `${diffDays}d ago`;
  } else if (diffDays < 30) {
    return `${Math.floor(diffDays / 7)}w ago`;
  } else if (diffDays < 365) {
    return `${Math.floor(diffDays / 30)}mo ago`;
  } else {
    return `${Math.floor(diffDays / 365)}y ago`;
  }
}

function formatDurationForDisplay(duration) {
  if (!duration || duration === 'Not specified') return '';
  
  // Handle "1:30:00" format (hours:minutes:seconds)
  const hmsMatch = duration.match(/^(\d+):(\d+):(\d+)$/);
  if (hmsMatch) {
    const [, hours, minutes, seconds] = hmsMatch;
    return `${hours}h ${minutes}m`;
  }
  
  // Handle "30:00" format (minutes:seconds)
  const msMatch = duration.match(/^(\d+):(\d+)$/);
  if (msMatch) {
    const [, minutes, seconds] = msMatch;
    return `${minutes}m`;
  }
  
  // Handle "90 minutes" format
  const minutesMatch = duration.match(/(\d+)\s*(?:min|minutes?)/i);
  if (minutesMatch) {
    const minutes = parseInt(minutesMatch[1]);
    return `${minutes}m`;
  }
  
  // Handle "2 hours" format
  const hoursMatch = duration.match(/(\d+)\s*(?:hr|hours?)/i);
  if (hoursMatch) {
    const hours = parseInt(hoursMatch[1]);
    return `${hours}h`;
  }
  
  // Handle "1h30m" format
  const hmMatch = duration.match(/(\d+)h\s*(\d+)m/i);
  if (hmMatch) {
    const [, hours, minutes] = hmMatch;
    return `${hours}h ${minutes}m`;
  }
  
  return duration;
}

function searchVideos(videos, query) {
  if (!query) return videos;
  
  const searchTerm = query.toLowerCase();
  return videos.filter(video => 
    (video.title && video.title.toLowerCase().includes(searchTerm)) ||
    (video.description && video.description.toLowerCase().includes(searchTerm)) ||
    (video.translator && video.translator.toLowerCase().includes(searchTerm)) ||
    (video.originalTitle && video.originalTitle.toLowerCase().includes(searchTerm)) ||
    (video.genre && Array.isArray(video.genre) && video.genre.some(g => g.toLowerCase().includes(searchTerm))) ||
    (video.metaKeywords && Array.isArray(video.metaKeywords) && video.metaKeywords.some(k => k.toLowerCase().includes(searchTerm)))
  );
}

function getLatestVideosByType(videos, limit = 8) {
  const grouped = {
    'MOVIE': [],
    'TV-SERIES': []
  };
  
  // Group videos by type
  videos.forEach(video => {
    if (video.contentType && grouped[video.contentType]) {
      grouped[video.contentType].push(video);
    }
  });

  // Sort each type by date and take latest N videos
  Object.keys(grouped).forEach(type => {
    grouped[type] = grouped[type]
      .sort((a, b) => new Date(b.uploadDate || 0) - new Date(a.uploadDate || 0))
      .slice(0, limit);
  });

  return grouped;
}

function generateSlug(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function generateBreadcrumbs(searchQuery, translatorFilter, typeFilter, baseUrl) {
  const items = [
    { name: 'Home', url: baseUrl + '/' },
    { name: 'Agasobanuye', url: baseUrl + '/agasobanuye/' }
  ];
  
  if (typeFilter) {
    items.push({
      name: typeFilter === 'MOVIE' ? 'Movies' : 'TV Shows',
      url: baseUrl + '/agasobanuye/?type=' + typeFilter
    });
  }
  
  if (translatorFilter) {
    items.push({
      name: 'Translator: ' + translatorFilter,
      url: baseUrl + '/agasobanuye/?translator=' + translatorFilter
    });
  }
  
  if (searchQuery) {
    items.push({
      name: 'Search: "' + searchQuery + '"',
      url: baseUrl + '/agasobanuye/?search=' + encodeURIComponent(searchQuery)
    });
  }
  
  // Mark last item as current
  if (items.length > 0) {
    items[items.length - 1].current = true;
  }
  
  return items;
}

function escapeHTML(str) {
  if (!str) return '';
  // Use a simple regex-based escape for Cloudflare Workers
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncate(str, maxLength) {
  if (!str) return '';
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength) + '...';
}

function generateHomepageHTML(data) {
  const { 
    searchQuery, 
    translatorFilter, 
    typeFilter, 
    filteredVideos, 
    allVideos, 
    translators, 
    latestByType,
    moviesCount,
    tvShowsCount,
    breadcrumbs,
    baseUrl 
  } = data;
  
  const isSearchOrFilter = searchQuery || translatorFilter || typeFilter;
  const totalVideos = allVideos.length;
  
  // Build canonical URL
  let canonicalUrl = baseUrl + '/agasobanuye/';
  const queryParams = [];
  if (typeFilter) queryParams.push(`type=${encodeURIComponent(typeFilter)}`);
  if (translatorFilter) queryParams.push(`translator=${encodeURIComponent(translatorFilter)}`);
  if (searchQuery) queryParams.push(`search=${encodeURIComponent(searchQuery)}`);
  
  if (queryParams.length > 0) {
    canonicalUrl = `${baseUrl}/agasobanuye/?${queryParams.join('&')}`;
  }

  // Generate Schema.org data
  const schemaData = {
    "@context": "https://schema.org",
    "@type": isSearchOrFilter ? "SearchResultsPage" : "WebPage",
    "name": isSearchOrFilter ? 
      `${searchQuery ? `Search: "${escapeHTML(searchQuery)}"` : ''}${translatorFilter ? ` by ${escapeHTML(translatorFilter)}` : ''}${typeFilter ? ` ${typeFilter === 'MOVIE' ? 'Movies' : 'TV Shows'}` : ''} - Agasobanuye` : 
      'Agasobanuye | Movies & TV Shows Translated to Kinyarwanda',
    "description": isSearchOrFilter ? 
      `${searchQuery ? `Search results for "${escapeHTML(searchQuery)}"` : 'Browse'}${translatorFilter ? ` translated by ${escapeHTML(translatorFilter)}` : ''}${typeFilter ? ` ${typeFilter === 'MOVIE' ? 'movies' : 'TV shows'}` : ''} - Watch content translated to Kinyarwanda` : 
      `Watch ${totalVideos} movies and TV shows translated to Kinyarwanda. High quality translations with English subtitles.`,
    "url": canonicalUrl,
    "breadcrumb": {
      "@type": "BreadcrumbList",
      "itemListElement": breadcrumbs.map((item, index) => ({
        "@type": "ListItem",
        "position": index + 1,
        "name": item.name,
        "item": item.url
      }))
    },
    "publisher": {
      "@type": "Organization",
      "name": "Rwanda Cinema",
      "logo": {
        "@type": "ImageObject",
        "url": baseUrl + "/logo.png",
        "width": 100,
        "height": 100
      }
    },
    "inLanguage": "rw",
    "dateModified": new Date().toISOString(),
    "mainEntity": {
      "@type": "ItemList",
      "numberOfItems": filteredVideos.length,
      "itemListElement": filteredVideos.slice(0, 10).map((video, index) => ({
        "@type": "ListItem",
        "position": index + 1,
        "item": {
          "@type": video.contentType === 'MOVIE' ? "Movie" : "TVSeries",
          "name": video.title,
          "description": video.description || video.title,
          "image": video.poster || baseUrl + "/images/default-poster.jpg",
          "datePublished": video.uploadDate,
          "duration": video.isoDuration || "PT0M",
          "translator": {
            "@type": "Person",
            "name": video.translator
          }
        }
      }))
    }
  };

  return `<!DOCTYPE html>
<html lang="en" prefix="og: https://ogp.me/ns#">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    
    <!-- Primary Meta Tags -->
    <title>${isSearchOrFilter ? 
      `${searchQuery ? `Search: "${escapeHTML(searchQuery)}"` : ''}${translatorFilter ? ` by ${escapeHTML(translatorFilter)}` : ''}${typeFilter ? ` ${typeFilter === 'MOVIE' ? 'Movies' : 'TV Shows'}` : ''} - Agasobanuye` : 
      'Agasobanuye | Movies & TV Shows Translated to Kinyarwanda'}</title>
    <meta name="description" content="${isSearchOrFilter ? 
      `${searchQuery ? `Search results for "${escapeHTML(searchQuery)}"` : 'Browse'}${translatorFilter ? ` translated by ${escapeHTML(translatorFilter)}` : ''}${typeFilter ? ` ${typeFilter === 'MOVIE' ? 'movies' : 'TV shows'}` : ''} - Watch content translated to Kinyarwanda` : 
      `Watch ${totalVideos} movies and TV shows translated to Kinyarwanda. High quality translations with English subtitles.`}">
    <meta name="keywords" content="Kinyarwanda movies, translated films, Rwanda cinema, watch online, subtitles, ${searchQuery}, ${translatorFilter}, ${typeFilter === 'MOVIE' ? 'movies' : 'TV shows'}">
    <meta name="robots" content="index, follow">
    <meta name="language" content="rw">
    
    <!-- Open Graph / Facebook -->
    <meta property="og:type" content="website">
    <meta property="og:url" content="${canonicalUrl}">
    <meta property="og:title" content="${isSearchOrFilter ? 
      `${searchQuery ? `Search: "${escapeHTML(searchQuery)}"` : ''}${translatorFilter ? ` by ${escapeHTML(translatorFilter)}` : ''}${typeFilter ? ` ${typeFilter === 'MOVIE' ? 'Movies' : 'TV Shows'}` : ''} - Agasobanuye` : 
      'Agasobanuye | Movies & TV Shows Translated to Kinyarwanda'}">
    <meta property="og:description" content="${isSearchOrFilter ? 
      `${searchQuery ? `Search results for "${escapeHTML(searchQuery)}"` : 'Browse'}${translatorFilter ? ` translated by ${escapeHTML(translatorFilter)}` : ''}${typeFilter ? ` ${typeFilter === 'MOVIE' ? 'movies' : 'TV shows'}` : ''} - Watch content translated to Kinyarwanda` : 
      `Watch ${totalVideos} movies and TV shows translated to Kinyarwanda. High quality translations with English subtitles.`}">
    <meta property="og:image" content="${allVideos[0]?.poster || baseUrl + '/og-image.jpg'}">
    <meta property="og:locale" content="rw_RW">
    <meta property="og:site_name" content="Rwanda Cinema">
    
    <!-- Twitter -->
    <meta property="twitter:card" content="summary_large_image">
    <meta property="twitter:url" content="${canonicalUrl}">
    <meta property="twitter:title" content="${isSearchOrFilter ? 
      `${searchQuery ? `Search: "${escapeHTML(searchQuery)}"` : ''}${translatorFilter ? ` by ${escapeHTML(translatorFilter)}` : ''}${typeFilter ? ` ${typeFilter === 'MOVIE' ? 'Movies' : 'TV Shows'}` : ''} - Agasobanuye` : 
      'Agasobanuye | Movies & TV Shows Translated to Kinyarwanda'}">
    <meta property="twitter:description" content="${isSearchOrFilter ? 
      `${searchQuery ? `Search results for "${escapeHTML(searchQuery)}"` : 'Browse'}${translatorFilter ? ` translated by ${escapeHTML(translatorFilter)}` : ''}${typeFilter ? ` ${typeFilter === 'MOVIE' ? 'movies' : 'TV shows'}` : ''} - Watch content translated to Kinyarwanda` : 
      `Watch ${totalVideos} movies and TV shows translated to Kinyarwanda. High quality translations with English subtitles.`}">
    <meta property="twitter:image" content="${allVideos[0]?.poster || baseUrl + '/og-image.jpg'}">

    <!-- Canonical URL -->
    <link rel="canonical" href="${canonicalUrl}">
    
    <!-- Structured Data -->
    <script type="application/ld+json">${JSON.stringify(schemaData)}</script>
    
    <style>
        :root {
            --primary: #008753;
            --secondary: #FAD201;
            --accent: #00A1DE;
            --dark: #0a0a0a;
            --card-bg: #1a1a1a;
            --text-light: #e0e0e0;
            --border: #333;
            --success: #28a745;
            --info: #17a2b8;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: 'Segoe UI', system-ui, sans-serif;
        }

        body {
            background: var(--dark);
            color: white;
            line-height: 1.6;
            min-height: 100vh;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 0 1rem;
        }

        /* Header */
        .header {
            background: var(--primary);
            padding: 1rem 0;
            border-bottom: 3px solid var(--secondary);
        }

        .header-content {
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 1rem;
        }

        .logo {
            color: white;
            text-decoration: none;
            font-size: 1.5rem;
            font-weight: bold;
        }

        .search-section {
            flex: 1;
            max-width: 500px;
        }

        .search-form {
            display: flex;
            gap: 0.5rem;
        }

        .search-input {
            flex: 1;
            padding: 0.75rem;
            border: none;
            border-radius: 6px;
            font-size: 1rem;
            background: rgba(255,255,255,0.9);
        }

        .search-button {
            background: var(--secondary);
            color: var(--dark);
            border: none;
            padding: 0.75rem 1.5rem;
            border-radius: 6px;
            cursor: pointer;
            font-weight: bold;
        }

        .nav {
            display: flex;
            gap: 1rem;
        }

        .nav-link {
            color: white;
            text-decoration: none;
            padding: 0.5rem 1rem;
            border-radius: 6px;
            transition: background 0.3s;
        }

        .nav-link:hover, .nav-link.active {
            background: rgba(255,255,255,0.1);
        }

        /* Breadcrumb */
        .breadcrumb {
            background: var(--card-bg);
            padding: 1rem;
            border-radius: 8px;
            margin: 1rem 0;
            font-size: 0.9rem;
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 0.5rem;
        }

        .breadcrumb a {
            color: var(--secondary);
            text-decoration: none;
        }

        .breadcrumb span {
            color: var(--text-light);
            margin: 0 0.5rem;
        }

        .breadcrumb .separator {
            color: var(--text-light);
            opacity: 0.6;
        }

        .breadcrumb [aria-current="page"] {
            color: white;
            font-weight: bold;
        }

        /* Hero Section */
        .hero {
            text-align: center;
            padding: 3rem 2rem;
            background: linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%);
            margin-bottom: 2rem;
            border-radius: 12px;
        }

        .hero h1 {
            font-size: 2.5rem;
            margin-bottom: 1rem;
            color: white;
            line-height: 1.2;
        }

        .hero p {
            font-size: 1.2rem;
            color: rgba(255,255,255,0.9);
            max-width: 600px;
            margin: 0 auto 2rem;
        }

        /* Video Grid */
        .videos-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: 1.5rem;
            margin: 2rem 0;
        }

        /* Video Card - Compact Design */
        .video-card {
            background: var(--card-bg);
            border-radius: 10px;
            overflow: hidden;
            transition: all 0.3s ease;
            border: 1px solid var(--border);
            height: 100%;
            display: flex;
            flex-direction: column;
        }

        .video-card:hover {
            transform: translateY(-4px);
            border-color: var(--primary);
            box-shadow: 0 8px 25px rgba(0, 135, 83, 0.2);
        }

        .video-link {
            text-decoration: none;
            color: inherit;
            display: block;
            flex-grow: 1;
        }

        .video-thumbnail {
            position: relative;
            width: 100%;
            height: 180px;
            overflow: hidden;
        }

        .video-thumbnail img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            transition: transform 0.3s ease;
        }

        .video-card:hover .video-thumbnail img {
            transform: scale(1.08);
        }

        /* Corner Badges */
        .quality-badge {
            position: absolute;
            top: 10px;
            left: 10px;
            background: linear-gradient(135deg, #ff416c, #ff4b2b);
            color: white;
            font-size: 0.7rem;
            font-weight: bold;
            padding: 3px 8px;
            border-radius: 4px;
            z-index: 2;
            box-shadow: 0 2px 5px rgba(0,0,0,0.3);
        }

        .date-badge {
            position: absolute;
            top: 10px;
            right: 10px;
            background: rgba(0, 0, 0, 0.8);
            backdrop-filter: blur(5px);
            color: var(--text-light);
            font-size: 0.7rem;
            padding: 3px 8px;
            border-radius: 4px;
            z-index: 2;
            box-shadow: 0 2px 5px rgba(0,0,0,0.3);
        }

        .duration-badge {
            position: absolute;
            bottom: 10px;
            right: 10px;
            background: rgba(0, 0, 0, 0.8);
            backdrop-filter: blur(5px);
            color: white;
            font-size: 0.7rem;
            padding: 3px 8px;
            border-radius: 4px;
            z-index: 2;
            box-shadow: 0 2px 5px rgba(0,0,0,0.3);
        }

        .video-overlay {
            position: absolute;
            inset: 0;
            background: linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 50%);
            opacity: 0;
            transition: opacity 0.3s ease;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .video-card:hover .video-overlay {
            opacity: 1;
        }

        .play-button {
            width: 50px;
            height: 50px;
            background: rgba(0, 135, 83, 0.9);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 1.2rem;
            border: 2px solid white;
            transition: all 0.3s ease;
        }

        .video-card:hover .play-button {
            background: #006641;
            transform: scale(1.1);
        }

        .video-info {
            padding: 1rem;
            flex-grow: 1;
            display: flex;
            flex-direction: column;
        }

        .video-title {
            font-size: 1rem;
            font-weight: 600;
            margin-bottom: 0.5rem;
            color: white;
            line-height: 1.3;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
            flex-grow: 1;
        }

        /* Video Metadata Below Poster */
        .video-metadata {
            display: flex;
            flex-direction: column;
            gap: 0.4rem;
            margin-top: 0.5rem;
            padding-top: 0.5rem;
            border-top: 1px solid rgba(255,255,255,0.1);
        }

        .metadata-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .metadata-item {
            display: flex;
            align-items: center;
            gap: 0.4rem;
            color: var(--text-light);
            font-size: 0.8rem;
        }

        .metadata-item i {
            color: var(--secondary);
            font-size: 0.9rem;
        }

        .translator-name {
            color: var(--secondary);
            font-weight: 500;
            font-size: 0.85rem;
        }

        .duration-text {
            color: #00ff9d;
            font-weight: 500;
        }

        /* Filters */
        .filters {
            background: var(--card-bg);
            padding: 1.5rem;
            border-radius: 12px;
            margin: 1.5rem 0;
        }

        .filter-section {
            margin-bottom: 1.5rem;
        }

        .filter-section h3 {
            margin-bottom: 1rem;
            color: var(--secondary);
            font-size: 1.1rem;
        }

        .filter-list {
            list-style: none;
            display: flex;
            flex-wrap: wrap;
            gap: 0.5rem;
        }

        .filter-list a {
            display: block;
            padding: 0.5rem 1rem;
            background: rgba(255,255,255,0.05);
            color: var(--text-light);
            text-decoration: none;
            border-radius: 6px;
            transition: all 0.3s;
            border: 1px solid transparent;
        }

        .filter-list a:hover, .filter-list a.active {
            background: var(--primary);
            color: white;
            border-color: var(--secondary);
        }

        /* Stats */
        .stats {
            display: flex;
            justify-content: center;
            gap: 3rem;
            margin: 2rem 0;
            flex-wrap: wrap;
        }

        .stat-item {
            text-align: center;
            padding: 1.5rem;
            background: var(--card-bg);
            border-radius: 12px;
            min-width: 150px;
            border: 1px solid var(--border);
        }

        .stat-number {
            font-size: 2.5rem;
            font-weight: bold;
            color: var(--secondary);
            display: block;
            margin-bottom: 0.5rem;
        }

        .stat-label {
            color: var(--text-light);
            font-size: 0.9rem;
        }

        /* Section Headers */
        .section-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin: 2rem 0 1rem;
            padding-bottom: 0.5rem;
            border-bottom: 2px solid var(--primary);
        }

        .section-title {
            font-size: 1.8rem;
            color: var(--secondary);
        }

        .view-all {
            color: var(--accent);
            text-decoration: none;
            font-weight: bold;
            transition: color 0.3s;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        .view-all:hover {
            color: var(--secondary);
        }

        /* No Results */
        .no-results {
            text-align: center;
            padding: 3rem;
            color: var(--text-light);
        }

        .no-results h2 {
            margin-bottom: 1rem;
            color: var(--secondary);
        }

        /* Footer */
        .footer {
            background: var(--card-bg);
            padding: 3rem 0;
            margin-top: 4rem;
            border-top: 3px solid var(--primary);
        }

        .footer-sections {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 2rem;
            margin-bottom: 2rem;
        }

        .footer-section h3 {
            color: var(--secondary);
            margin-bottom: 1rem;
            font-size: 1.2rem;
        }

        .footer-section a {
            display: block;
            color: var(--text-light);
            text-decoration: none;
            margin-bottom: 0.5rem;
            transition: color 0.3s;
        }

        .footer-section a:hover {
            color: var(--accent);
        }

        .footer-bottom {
            text-align: center;
            padding-top: 2rem;
            border-top: 1px solid var(--border);
            color: var(--text-light);
        }

        /* Responsive Design */
        @media (max-width: 768px) {
            .header-content {
                flex-direction: column;
                text-align: center;
            }
            
            .search-section {
                width: 100%;
            }
            
            .videos-grid {
                grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
                gap: 1rem;
            }
            
            .video-thumbnail {
                height: 160px;
            }
            
            .stats {
                gap: 1rem;
            }
            
            .stat-item {
                min-width: 120px;
                padding: 1rem;
            }
        }

        @media (max-width: 480px) {
            .videos-grid {
                grid-template-columns: 1fr;
            }
            
            .video-thumbnail {
                height: 180px;
            }
        }
    </style>
</head>
<body>
    <!-- Header -->
    <header class="header" role="banner">
        <div class="container">
            <div class="header-content">
                <a href="${baseUrl}/" class="logo">🏠 Rwanda Cinema</a>
                
                <div class="search-section">
                    <form class="search-form" action="${baseUrl}/agasobanuye/" method="GET" role="search">
                        <input type="text" 
                               name="search" 
                               class="search-input" 
                               placeholder="Search translated movies..." 
                               value="${escapeHTML(searchQuery)}"
                               aria-label="Search translated content">
                        <button type="submit" class="search-button">Search</button>
                    </form>
                </div>
                
                <nav class="nav" role="navigation" aria-label="Main navigation">
                    <a href="${baseUrl}/" class="nav-link">Home</a>
                    <a href="${baseUrl}/agasobanuye/" class="nav-link active">Agasobanuye</a>
                </nav>
            </div>
        </div>
    </header>

    <!-- Main Content -->
    <main class="container" role="main">
        <!-- Breadcrumb -->
        <nav class="breadcrumb" aria-label="Breadcrumb">
            ${breadcrumbs.map((item, index) => `
                ${index > 0 ? '<span class="separator">/</span>' : ''}
                ${item.current ? 
                  `<span aria-current="page">${item.name}</span>` : 
                  `<a href="${item.url}">${item.name}</a>`}
            `).join('')}
        </nav>

        ${isSearchOrFilter ? `
            <!-- Search/Filter Results -->
            <div class="section-header">
                <h1>
                    ${searchQuery ? `Search: "${escapeHTML(searchQuery)}"` : ''}
                    ${translatorFilter ? `Translator: ${escapeHTML(translatorFilter)}` : ''}
                    ${typeFilter ? `${typeFilter === 'MOVIE' ? 'Movies' : 'TV Shows'}` : ''}
                </h1>
                <span>${filteredVideos.length} results</span>
            </div>

            ${filteredVideos.length > 0 ? `
                <div class="videos-grid">
                    ${filteredVideos.map(video => generateVideoCard(video, baseUrl)).join('')}
                </div>
            ` : `
                <div class="no-results">
                    <h2>No videos found</h2>
                    <p>Try adjusting your search terms or remove filters.</p>
                    <a href="${baseUrl}/agasobanuye/" class="search-button" style="display: inline-block; margin-top: 1rem;">Clear Filters</a>
                </div>
            `}
        ` : `
            <!-- Homepage Content -->
            <section class="hero">
                <h1>Watch Movies & TV Shows Translated to Kinyarwanda</h1>
                <p>Stream ${totalVideos} high-quality translations with English subtitles. Experience your favorite content in Kinyarwanda.</p>
            </section>

            <!-- Stats -->
            <div class="stats">
                <div class="stat-item">
                    <span class="stat-number">${totalVideos}</span>
                    <span class="stat-label">Total Translations</span>
                </div>
                <div class="stat-item">
                    <span class="stat-number">${moviesCount}</span>
                    <span class="stat-label">Movies</span>
                </div>
                <div class="stat-item">
                    <span class="stat-number">${tvShowsCount}</span>
                    <span class="stat-label">TV Shows</span>
                </div>
                <div class="stat-item">
                    <span class="stat-number">${translators.length}</span>
                    <span class="stat-label">Translators</span>
                </div>
            </div>

            <!-- Filters -->
            <div class="filters">
                <div class="filter-section">
                    <h3>Browse by Type</h3>
                    <ul class="filter-list">
                        <li><a href="${baseUrl}/agasobanuye/" class="${!typeFilter ? 'active' : ''}">All Content</a></li>
                        <li><a href="${baseUrl}/agasobanuye/?type=MOVIE" class="${typeFilter === 'MOVIE' ? 'active' : ''}">Movies (${moviesCount})</a></li>
                        <li><a href="${baseUrl}/agasobanuye/?type=TV-SERIES" class="${typeFilter === 'TV-SERIES' ? 'active' : ''}">TV Shows (${tvShowsCount})</a></li>
                    </ul>
                </div>
                
                ${translators.length > 0 ? `
                <div class="filter-section">
                    <h3>Browse by Translator</h3>
                    <ul class="filter-list">
                        <li><a href="${baseUrl}/agasobanuye/" class="${!translatorFilter ? 'active' : ''}">All Translators</a></li>
                        ${translators.slice(0, 8).map(translator => `
                            <li>
                                <a href="${baseUrl}/agasobanuye/?translator=${translator.slug}" 
                                   class="${translatorFilter === translator.slug ? 'active' : ''}">
                                    ${escapeHTML(translator.name)} (${translator.count})
                                </a>
                            </li>
                        `).join('')}
                    </ul>
                </div>
                ` : ''}
            </div>

            <!-- Latest Movies -->
            ${latestByType['MOVIE'] && latestByType['MOVIE'].length > 0 ? `
                <div class="section-header">
                    <h2 class="section-title">Latest Movie Translations</h2>
                    <a href="${baseUrl}/agasobanuye/?type=MOVIE" class="view-all">View All Movies →</a>
                </div>
                <div class="videos-grid">
                    ${latestByType['MOVIE'].map(video => generateVideoCard(video, baseUrl)).join('')}
                </div>
            ` : ''}

            <!-- Latest TV Shows -->
            ${latestByType['TV-SERIES'] && latestByType['TV-SERIES'].length > 0 ? `
                <div class="section-header">
                    <h2 class="section-title">Latest TV Show Translations</h2>
                    <a href="${baseUrl}/agasobanuye/?type=TV-SERIES" class="view-all">View All TV Shows →</a>
                </div>
                <div class="videos-grid">
                    ${latestByType['TV-SERIES'].map(video => generateVideoCard(video, baseUrl)).join('')}
                </div>
            ` : ''}
        `}
    </main>

    <!-- Footer -->
    <footer class="footer" role="contentinfo">
        <div class="container">
            <div class="footer-sections">
                <div class="footer-section">
                    <h3>Agasobanuye</h3>
                    <a href="${baseUrl}/agasobanuye/">All Translations</a>
                    <a href="${baseUrl}/agasobanuye/?type=MOVIE">Kinyarwanda Movies</a>
                    <a href="${baseUrl}/agasobanuye/?type=TV-SERIES">Kinyarwanda TV Shows</a>
                </div>
                
                <div class="footer-section">
                    <h3>Company</h3>
                    <a href="${baseUrl}/about">About Rwanda Cinema</a>
                    <a href="${baseUrl}/contact">Contact Us</a>
                    <a href="${baseUrl}/privacy">Privacy Policy</a>
                    <a href="${baseUrl}/terms">Terms of Service</a>
                </div>
            </div>
            
            <div class="footer-bottom">
                <p>&copy; ${new Date().getFullYear()} Rwanda Cinema. All rights reserved.</p>
                <p>Bringing global content to Kinyarwanda speakers worldwide</p>
            </div>
        </div>
    </footer>
</body>
</html>`;
}

function generateVideoCard(video, baseUrl) {
  const posterUrl = video.poster || `${baseUrl}/images/default-poster.jpg`;
  // Use the new URL structure: /watch/movie/slug or /watch/tv-series/slug
  const typeSlug = video.contentType === 'MOVIE' ? 'movie' : 'tv-series';
  const watchUrl = `${baseUrl}/watch/${typeSlug}/${video.slug}`;
  const translatorUrl = `${baseUrl}/agasobanuye/?translator=${video.translatorSlug}`;
  
  // Generate VideoObject schema for this specific video
  const videoSchema = {
    "@context": "https://schema.org",
    "@type": video.contentType === 'MOVIE' ? "Movie" : "TVSeries",
    "name": video.title,
    "description": video.description || video.title,
    "image": posterUrl,
    "thumbnailUrl": posterUrl,
    "uploadDate": video.uploadDate,
    "datePublished": video.uploadDate,
    "duration": video.isoDuration || "PT0M",
    "contentUrl": watchUrl,
    "genre": video.genre || ["Translated Content"],
    "inLanguage": "rw",
    "subtitleLanguage": "en",
    "translator": {
      "@type": "Person",
      "name": video.translator
    },
    "publisher": {
      "@type": "Organization",
      "name": "Rwanda Cinema"
    }
  };
  
  return `
  <div class="video-card">
      <script type="application/ld+json">${JSON.stringify(videoSchema)}</script>
      
      <a href="${watchUrl}" class="video-link">
          <div class="video-thumbnail">
              <img src="${posterUrl}" 
                   alt="${escapeHTML(video.title)} - Kinyarwanda translation" 
                   loading="lazy"
                   onerror="this.src='${baseUrl}/images/default-poster.jpg'">
              
              <!-- Quality badge - Top left -->
              ${video.quality && video.quality !== 'Not specified' ? `
              <div class="quality-badge">
                  ${video.quality}
              </div>
              ` : ''}
              
              <!-- Date badge - Top right -->
              ${video.shortDate ? `
              <div class="date-badge">
                  ${video.shortDate}
              </div>
              ` : ''}
              
              <!-- Duration badge - Bottom right -->
              ${video.formattedDuration ? `
              <div class="duration-badge">
                  ${video.formattedDuration}
              </div>
              ` : ''}
              
              <div class="video-overlay">
                  <div class="play-button">▶</div>
              </div>
          </div>
          <div class="video-info">
              <h3 class="video-title">${escapeHTML(truncate(video.title, 60))}</h3>
              
              <div class="video-metadata">
                  <!-- First row: Title (already shown above) -->
                  <!-- Second row: Translator -->
                  <div class="metadata-row">
                      <div class="metadata-item">
                          <i>👤</i>
                          <span class="translator-name">${escapeHTML(video.translator || 'Unknown')}</span>
                      </div>
                      ${video.formattedDuration ? `
                      <div class="metadata-item">
                          <i>⏱️</i>
                          <span class="duration-text">${video.formattedDuration}</span>
                      </div>
                      ` : ''}
                  </div>
                  
                  <!-- Third row: Duration and Type -->
                  ${video.contentType || video.releaseYear ? `
                  <div class="metadata-row">
                      <div class="metadata-item">
                          <i>🎬</i>
                          <span>${video.contentType === 'MOVIE' ? 'Movie' : 'TV Series'}</span>
                      </div>
                      ${video.releaseYear ? `
                      <div class="metadata-item">
                          <i>📅</i>
                          <span>${video.releaseYear}</span>
                      </div>
                      ` : ''}
                  </div>
                  ` : ''}
              </div>
          </div>
      </a>
  </div>
  `;
}

function generateErrorHTML(baseUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <title>Error - Agasobanuye</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { background: #0a0a0a; color: white; text-align: center; padding: 4rem 2rem; font-family: system-ui; }
        h1 { color: #FAD201; margin-bottom: 1rem; }
        a { background: #008753; color: white; padding: 1rem 2rem; text-decoration: none; border-radius: 8px; display: inline-block; margin-top: 1rem; }
    </style>
</head>
<body>
    <h1>Something Went Wrong</h1>
    <p>We're having trouble loading the translated content. Please try again later.</p>
    <a href="${baseUrl}/agasobanuye/">Go Back to Agasobanuye</a>
</body>
</html>`;
      }
