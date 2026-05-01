import { buildApplicationPackage } from './agent.js'
import { analyzeProfileAgainstJob } from './matcher.js'

export function rankJobsForProfile(profile, jobs, tailoringMode = 'keywords') {
  return jobs
    .map((job) => {
      const analysis = analyzeProfileAgainstJob(profile, {
        jobDescription: job.description,
        jobTitle: job.title,
      })

      return {
        ...job,
        fitScore: analysis.fitScore,
        matchedKeywords: analysis.matchedKeywords,
        missingKeywords: analysis.missingKeywords,
        analysis,
        suggestedPackage: buildApplicationPackage(profile, {
          company: job.company,
          jobDescription: job.description,
          jobTitle: job.title,
          tailoringMode,
        }),
      }
    })
    .sort((left, right) => right.fitScore - left.fitScore)
}
