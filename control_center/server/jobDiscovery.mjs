const JOB_CACHE_TTL_MS = 15 * 60 * 1000
const liveJobCache = new Map()

const ATS_SOURCES = {
  zaid: [
    { provider: 'lever', site: 'palantir', company: 'Palantir' },
    { provider: 'greenhouse', token: 'wizinc', company: 'Wiz' },
    { provider: 'greenhouse', token: 'cloudflare', company: 'Cloudflare' },
    { provider: 'greenhouse', token: 'datadog', company: 'Datadog' },
    { provider: 'greenhouse', token: 'okta', company: 'Okta' },
    { provider: 'greenhouse', token: 'gitlab', company: 'GitLab' },
  ],
  atir: [
    { provider: 'lever', site: 'palantir', company: 'Palantir' },
    { provider: 'greenhouse', token: 'cloudflare', company: 'Cloudflare' },
    { provider: 'greenhouse', token: 'vercel', company: 'Vercel' },
    { provider: 'greenhouse', token: 'mongodb', company: 'MongoDB' },
    { provider: 'greenhouse', token: 'datadog', company: 'Datadog' },
    { provider: 'greenhouse', token: 'gitlab', company: 'GitLab' },
    { provider: 'greenhouse', token: 'samsara', company: 'Samsara' },
  ],
}

const PROFILE_SEARCH_DEFAULTS = {
  zaid: {
    defaultQuery: 'cybersecurity manager',
    requiredTitleGroups: [
      ['security', 'cyber', 'trust', 'incident', 'risk'],
      ['manager', 'lead', 'head', 'director'],
    ],
    excludedTitleKeywords: [
      'marketing',
      'product manager',
      'revenue',
      'account executive',
      'sales',
      'customer success',
    ],
    titleKeywords: [
      'cybersecurity manager',
      'security manager',
      'security program manager',
      'cyber program manager',
      'security operations',
      'security engineering manager',
      'security',
      'cyber',
      'trust',
      'risk',
    ],
    descriptionKeywords: [
      'incident response',
      'siem',
      'splunk',
      'security operations',
      'security governance',
      'cloud security',
      'security program',
      'risk management',
    ],
  },
  atir: {
    defaultQuery: 'project manager',
    requiredTitleGroups: [
      ['manager', 'lead'],
      ['project', 'program', 'engagement', 'delivery', 'implementation', 'transformation', 'service'],
    ],
    excludedTitleKeywords: ['intern'],
    titleKeywords: [
      'engagement manager',
      'project manager',
      'program manager',
      'delivery manager',
      'implementation manager',
      'service delivery manager',
      'transformation manager',
      'technical program manager',
      'customer success manager',
    ],
    descriptionKeywords: [
      'stakeholder management',
      'project delivery',
      'service delivery',
      'change management',
      'implementation',
      'transformation',
      'rollout',
      'enterprise',
      'cross-functional',
    ],
  },
}

function stripTags(value) {
  return value.replace(/<[^>]+>/g, ' ')
}

function decodeEntities(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, ' ').trim()
}

function plainText(value) {
  if (!value) {
    return ''
  }

  return normalizeWhitespace(stripTags(decodeEntities(String(value))))
}

function truncate(value, maxLength = 900) {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, maxLength - 1).trimEnd()}…`
}

function relativeTime(value) {
  if (!value) {
    return 'Recently posted'
  }

  const publishedAt = new Date(value)

  if (Number.isNaN(publishedAt.getTime())) {
    return 'Recently posted'
  }

  const diffMs = Date.now() - publishedAt.getTime()
  const dayMs = 24 * 60 * 60 * 1000

  if (diffMs < dayMs) {
    const hours = Math.max(1, Math.round(diffMs / (60 * 60 * 1000)))
    return `${hours}h ago`
  }

  if (diffMs < 7 * dayMs) {
    return `${Math.max(1, Math.round(diffMs / dayMs))}d ago`
  }

  if (diffMs < 30 * dayMs) {
    return `${Math.max(1, Math.round(diffMs / (7 * dayMs)))}w ago`
  }

  return `${Math.max(1, Math.round(diffMs / (30 * dayMs)))}mo ago`
}

function buildCacheKey(profileId, query, location, limit) {
  return JSON.stringify({
    profileId,
    query: query.trim().toLowerCase(),
    location: location.trim().toLowerCase(),
    limit,
  })
}

function keywordScore(text, keywords, weight) {
  const haystack = text.toLowerCase()

  return keywords.reduce((score, keyword) => {
    const term = keyword.trim().toLowerCase()

    if (!term) {
      return score
    }

    return haystack.includes(term) ? score + weight : score
  }, 0)
}

function tokenizeQuery(value) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9+#/.-]+/)
    .filter((token) => token.length > 1)
}

function locationMatches(job, locationQuery) {
  if (!locationQuery.trim()) {
    return true
  }

  const haystack = `${job.location} ${job.workplaceType || ''} ${job.description}`.toLowerCase()
  const tokens = tokenizeQuery(locationQuery)

  return tokens.every((token) => haystack.includes(token))
}

function scoreJob(job, config, query) {
  const queryTerms = query.trim()
    ? [query, ...tokenizeQuery(query)]
    : config.titleKeywords

  const titleText = `${job.title} ${job.company}`.toLowerCase()
  const bodyText =
    `${job.title} ${job.company} ${job.location} ${job.description} ${job.department || ''}`.toLowerCase()

  return (
    keywordScore(titleText, queryTerms, 8) +
    keywordScore(bodyText, config.titleKeywords, 5) +
    keywordScore(bodyText, config.descriptionKeywords, 2)
  )
}

function passesProfileGate(job, config) {
  const title = job.title.toLowerCase()

  if (
    (config.excludedTitleKeywords || []).some((keyword) =>
      title.includes(keyword.toLowerCase()),
    )
  ) {
    return false
  }

  return (config.requiredTitleGroups || []).every((group) =>
    group.some((keyword) => title.includes(keyword.toLowerCase())),
  )
}

async function fetchJson(url) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12000)

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    return await response.json()
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchGreenhouseJobs(source) {
  const data = await fetchJson(
    `https://boards-api.greenhouse.io/v1/boards/${source.token}/jobs?content=true`,
  )

  return (data.jobs || []).map((job) => ({
    id: `greenhouse:${source.token}:${job.id}`,
    title: job.title,
    company: job.company_name || source.company,
    location: job.location?.name || 'Location not listed',
    source: `${source.company} · Greenhouse`,
    postedAt: relativeTime(job.first_published || job.updated_at),
    postedAtRaw: job.first_published || job.updated_at || '',
    url: job.absolute_url,
    applyUrl: job.absolute_url,
    description: truncate(plainText(job.content)),
    department: (job.departments || []).map((item) => item.name).join(', '),
    workplaceType: (job.offices || []).map((item) => item.location).join(', '),
  }))
}

async function fetchLeverJobs(source) {
  const data = await fetchJson(
    `https://api.lever.co/v0/postings/${source.site}?mode=json`,
  )

  return (data || []).map((job) => ({
    id: `lever:${source.site}:${job.id}`,
    title: job.text,
    company: source.company,
    location:
      job.categories?.location ||
      job.categories?.allLocations?.join(', ') ||
      'Location not listed',
    source: `${source.company} · Lever`,
    postedAt: relativeTime(job.createdAt),
    postedAtRaw: job.createdAt ? new Date(job.createdAt).toISOString() : '',
    url: job.hostedUrl || job.applyUrl,
    applyUrl: job.applyUrl || job.hostedUrl,
    description: truncate(
      plainText(job.descriptionBodyPlain || job.descriptionPlain || job.additionalPlain),
    ),
    department: job.categories?.team || '',
    workplaceType: job.workplaceType || '',
  }))
}

async function fetchSourceJobs(source) {
  if (source.provider === 'greenhouse') {
    return fetchGreenhouseJobs(source)
  }

  if (source.provider === 'lever') {
    return fetchLeverJobs(source)
  }

  return []
}

export async function discoverLiveJobs({
  profileId,
  query = '',
  location = '',
  limit = 18,
}) {
  const config = PROFILE_SEARCH_DEFAULTS[profileId] || PROFILE_SEARCH_DEFAULTS.zaid
  const sources = ATS_SOURCES[profileId] || ATS_SOURCES.zaid
  const queryToUse = query.trim() || config.defaultQuery
  const cacheKey = buildCacheKey(profileId, queryToUse, location, limit)
  const cached = liveJobCache.get(cacheKey)

  if (cached && cached.expiresAt > Date.now()) {
    return cached.payload
  }

  const settled = await Promise.allSettled(sources.map((source) => fetchSourceJobs(source)))
  const errors = []
  const jobs = []

  for (const result of settled) {
    if (result.status === 'fulfilled') {
      jobs.push(...result.value)
      continue
    }

    errors.push(result.reason instanceof Error ? result.reason.message : 'Unknown source error')
  }

  const dedupedJobs = Array.from(
    new Map(jobs.map((job) => [job.url, job])).values(),
  )

  const filteredJobs = dedupedJobs
    .filter((job) => passesProfileGate(job, config))
    .filter((job) => locationMatches(job, location))
    .map((job) => ({
      ...job,
      searchScore: scoreJob(job, config, queryToUse),
    }))
    .filter((job) => job.searchScore > 0)
    .sort((left, right) => {
      if (right.searchScore !== left.searchScore) {
        return right.searchScore - left.searchScore
      }

      return (right.postedAtRaw || '').localeCompare(left.postedAtRaw || '')
    })
    .slice(0, limit)

  const payload = {
    ok: true,
    jobs: filteredJobs,
    queryUsed: queryToUse,
    fetchedAt: new Date().toISOString(),
    sourceCount: sources.length,
    warnings: errors,
  }

  liveJobCache.set(cacheKey, {
    expiresAt: Date.now() + JOB_CACHE_TTL_MS,
    payload,
  })

  return payload
}
