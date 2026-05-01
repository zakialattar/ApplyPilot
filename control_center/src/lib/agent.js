import { analyzeProfileAgainstJob } from './matcher.js'

function buildTailoredBullets(profile, analysis, tailoringMode) {
  const sourceBullets =
    analysis.evidenceBullets.length > 0
      ? analysis.evidenceBullets.map((item) => item.text)
      : profile.experience.flatMap((role) => role.points)

  if (tailoringMode === 'nudge') {
    return sourceBullets.slice(0, 3)
  }

  if (tailoringMode === 'full') {
    return sourceBullets.slice(0, 5)
  }

  return sourceBullets.slice(0, 4)
}

function buildWorkflow(profile, analysis, companyLabel) {
  const reviewStatus = profile.matchStatus.toLowerCase().includes('not verified')
    ? 'blocked'
    : 'ready'

  return [
    {
      name: 'Planner',
      owner: 'PlanningAgent',
      status: 'complete',
      detail: `Mapped the job brief to ${profile.targetRoles[0]} and extracted ${analysis.matchedKeywords.length + analysis.missingKeywords.length} relevant signals.`,
    },
    {
      name: 'Evidence matcher',
      owner: 'ResumeMatcher',
      status: analysis.missingKeywords.length > 0 ? 'in_progress' : 'complete',
      detail: `${analysis.matchedKeywords.length} keywords matched against the master profile and ${analysis.missingKeywords.length} require human review.`,
    },
    {
      name: 'Package writer',
      owner: 'ProfileWriter',
      status: 'complete',
      detail: `Prepared a tailored summary, bullets, outreach note, and cover note for ${companyLabel}.`,
    },
    {
      name: 'Human review',
      owner: 'ComplianceGate',
      status: reviewStatus,
      detail:
        reviewStatus === 'blocked'
          ? 'Exact profile grounding still needs confirmation before submission.'
          : 'Profile grounding is sufficient for a human-reviewed submission.',
    },
    {
      name: 'Submit',
      owner: 'ApplyBot',
      status: 'ready',
      detail: `Ready for manual or semi-automated submission to ${companyLabel}.`,
    },
  ]
}

export function buildApplicationPackage(
  profile,
  { company, jobDescription, jobTitle, tailoringMode = 'keywords' },
) {
  const companyLabel = company.trim() || 'the target company'
  const roleLabel = jobTitle.trim() || profile.defaultJobTitle
  const analysis = analyzeProfileAgainstJob(profile, { jobDescription, jobTitle: roleLabel })
  const tailoredBullets = buildTailoredBullets(profile, analysis, tailoringMode)
  const workflow = buildWorkflow(profile, analysis, companyLabel)
  const modeLabel =
    tailoringMode === 'nudge'
      ? 'Nudge'
      : tailoringMode === 'full'
        ? 'Full'
        : 'Keywords'

  return {
    heading: `${profile.name} for ${roleLabel}${company ? ` at ${company}` : ''}`,
    modeLabel,
    fitScore: analysis.fitScore,
    coverageScore: analysis.coverageScore,
    matchedKeywords: analysis.matchedKeywords,
    missingKeywords: analysis.missingKeywords,
    evidenceBullets: analysis.evidenceBullets,
    matchReasons: analysis.matchReasons,
    recommendations: analysis.recommendations,
    workflow,
    workflowSummary:
      workflow.find((step) => step.status === 'blocked')?.name ??
      workflow.find((step) => step.status === 'in_progress')?.name ??
      'Ready',
    tailoredSummary: `${profile.summary} For ${companyLabel}, the best positioning is around ${analysis.matchedKeywords
      .slice(0, 3)
      .join(', ') || profile.coreSkills.slice(0, 3).join(', ')}, while keeping the story anchored in proven delivery rather than generic claims.`,
    tailoredBullets,
    coverNote: `I am applying for the ${roleLabel} role at ${companyLabel}. My background in ${profile.focus.toLowerCase()} combines hands-on execution with structured delivery, and the attached resume version emphasizes ${analysis.matchedKeywords
      .slice(0, 3)
      .join(', ') || 'role-relevant execution'} in a way that maps directly to your brief.`,
    outreachNote: `Hi, I’m reaching out about the ${roleLabel} opening at ${companyLabel}. I’ve prepared a tailored resume for ${profile.name} that highlights ${analysis.matchedKeywords
      .slice(0, 3)
      .join(', ') || profile.coreSkills.slice(0, 3).join(', ')} and would value the chance to discuss fit.`,
  }
}
