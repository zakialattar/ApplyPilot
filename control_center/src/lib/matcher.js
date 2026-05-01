const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'into',
  'your',
  'their',
  'will',
  'have',
  'has',
  'role',
  'team',
  'teams',
  'work',
  'works',
  'working',
  'job',
  'jobs',
  'position',
  'positions',
  'required',
  'preferred',
  'requirements',
  'responsibilities',
  'experience',
  'years',
  'strong',
  'ability',
  'skills',
  'knowledge',
  'using',
  'across',
  'through',
  'about',
  'where',
  'while',
  'must',
  'need',
  'plus',
  'also',
])

const DOMAIN_PHRASES = [
  'security operations',
  'incident response',
  'threat modeling',
  'siem',
  'splunk',
  'servicenow',
  'aws',
  'nist',
  'iso 27001',
  'tableau',
  'python',
  'powershell',
  'firewall',
  'palo alto',
  'juniper',
  'stakeholder management',
  'project delivery',
  'change management',
  'vendor management',
  'service transition',
  'office 365',
  'sharepoint',
  'network transformation',
  'executive reporting',
  'risk management',
  'compliance',
  'cloud',
]

function normalize(text) {
  return text.toLowerCase().replace(/[^a-z0-9+#.\-\s]/g, ' ')
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function tokenize(text) {
  return normalize(text)
    .split(/\s+/)
    .filter(
      (token) =>
        token.length > 2 && !STOP_WORDS.has(token) && !/^\d+$/.test(token),
    )
}

export function extractKeywordSignals(jobDescription, profile) {
  const normalizedJob = normalize(jobDescription)
  const profileSignals = [
    ...profile.coreSkills,
    ...profile.targetRoles,
    ...profile.experience.flatMap((role) => [role.title, ...role.points]),
  ].map((item) => item.toLowerCase())

  const phraseMatches = DOMAIN_PHRASES.filter(
    (phrase) =>
      normalizedJob.includes(phrase) ||
      profileSignals.some((item) => item.includes(phrase)),
  )

  const tokenCounts = new Map()
  for (const token of tokenize(jobDescription)) {
    tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1)
  }

  const tokenMatches = [...tokenCounts.entries()]
    .sort((left, right) => right[1] - left[1] || right[0].length - left[0].length)
    .map(([token]) => token)
    .filter(
      (token) =>
        tokenCounts.get(token) > 1 ||
        DOMAIN_PHRASES.some((phrase) => phrase.includes(token)) ||
        profileSignals.some((item) => item.includes(token)),
    )
    .slice(0, 10)

  return unique([...phraseMatches, ...tokenMatches]).slice(0, 14)
}

function buildProfileCorpus(profile) {
  return normalize(
    [
      profile.focus,
      profile.summary,
      ...profile.targetRoles,
      ...profile.coreSkills,
      ...profile.credentials,
      ...profile.experience.flatMap((role) => [role.title, role.company, ...role.points]),
    ].join(' '),
  )
}

export function segmentTextByKeywords(text, keywords) {
  const parts = text.split(/([^a-zA-Z0-9+#.-]+)/)

  return parts
    .filter(Boolean)
    .map((part) => ({
      text: part,
      isMatch: keywords.has(part.toLowerCase()),
    }))
}

export function analyzeProfileAgainstJob(profile, { jobDescription, jobTitle }) {
  const profileCorpus = buildProfileCorpus(profile)
  const signals = extractKeywordSignals(jobDescription, profile)
  const matchedKeywords = signals.filter((signal) =>
    profileCorpus.includes(signal.toLowerCase()),
  )
  const missingKeywords = signals.filter(
    (signal) => !profileCorpus.includes(signal.toLowerCase()),
  )

  const evidenceBullets = profile.experience
    .flatMap((role) =>
      role.points.map((text) => ({
        section: role.company,
        role: role.title,
        text,
        matches: matchedKeywords.filter((keyword) =>
          normalize(text).includes(keyword.toLowerCase()),
        ),
      })),
    )
    .filter((item) => item.matches.length > 0)
    .sort((left, right) => right.matches.length - left.matches.length)
    .slice(0, 6)

  const roleTokens = tokenize(jobTitle)
  const roleAlignment = roleTokens.filter((token) =>
    normalize(profile.targetRoles.join(' ')).includes(token),
  ).length
  const coverageScore = signals.length
    ? Math.round((matchedKeywords.length / signals.length) * 100)
    : 72
  const fitScore = Math.max(
    52,
    Math.min(96, coverageScore + 18 + roleAlignment * 6 - missingKeywords.length * 2),
  )

  const matchReasons = unique([
    `${profile.name} already aligns to ${profile.focus.toLowerCase()}.`,
    matchedKeywords[0]
      ? `The current profile already shows evidence for ${matchedKeywords[0]}.`
      : 'The profile contains reusable enterprise delivery evidence.',
    missingKeywords.length
      ? `The main gaps are ${missingKeywords.slice(0, 3).join(', ')}.`
      : 'No obvious high-priority keyword gaps were detected in the brief.',
  ])

  const recommendations = unique([
    missingKeywords.length
      ? `Address ${missingKeywords.slice(0, 3).join(', ')} only if Zaid or Atir can support them truthfully.`
      : 'Keep the current evidence set and tighten wording rather than inventing new claims.',
    evidenceBullets[0]
      ? `Lead with the bullet about ${evidenceBullets[0].matches[0]} in the first half of the resume.`
      : 'Move the strongest quantified bullet higher in the experience section.',
    'Keep external submissions human-reviewed before clicking submit.',
  ])

  return {
    fitScore,
    coverageScore,
    matchedKeywords,
    missingKeywords,
    evidenceBullets,
    matchReasons,
    recommendations,
  }
}
