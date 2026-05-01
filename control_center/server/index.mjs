import { spawn } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const IS_WINDOWS = process.platform === 'win32'
const CONTROL_CENTER_DIR = path.resolve(__dirname, '..')
const DIST_DIR = path.join(CONTROL_CENTER_DIR, 'dist')
const APPLYPILOT_REPO = path.resolve(CONTROL_CENTER_DIR, '..')
const APPLYPILOT_HOME = process.env.APPLYPILOT_DIR || path.join(os.homedir(), '.applypilot')
const APPLYPILOT_VENV = path.join(APPLYPILOT_REPO, '.venv')
const VENV_BIN_DIR = path.join(APPLYPILOT_VENV, IS_WINDOWS ? 'Scripts' : 'bin')
const PYTHON_BIN = path.join(VENV_BIN_DIR, IS_WINDOWS ? 'python.exe' : 'python')
const PIP_BIN = path.join(VENV_BIN_DIR, IS_WINDOWS ? 'pip.exe' : 'pip')
const PORT = Number(process.env.PORT || 8787)
const HOST = process.env.HOST || '127.0.0.1'
const APP_URL = `http://${HOST}:${PORT}`
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
}

const tasks = new Map()

function jsonResponse(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
  })
  res.end(JSON.stringify(payload))
}

async function readJsonBody(req) {
  const chunks = []

  for await (const chunk of req) {
    chunks.push(chunk)
  }

  if (chunks.length === 0) {
    return {}
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function taskSummary(task) {
  return {
    id: task.id,
    action: task.action,
    label: task.label,
    status: task.status,
    startedAt: task.startedAt,
    endedAt: task.endedAt,
    logs: task.logs,
    exitCode: task.exitCode,
  }
}

function appendTaskLog(task, text) {
  task.logs = `${task.logs}${text}`
  if (task.logs.length > 120000) {
    task.logs = task.logs.slice(-120000)
  }
}

function createTask(label, action) {
  const id = `task-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  const task = {
    id,
    action,
    label,
    status: 'running',
    startedAt: new Date().toISOString(),
    endedAt: null,
    logs: '',
    exitCode: null,
  }
  tasks.set(id, task)
  return task
}

function getShellCommand(script) {
  if (IS_WINDOWS) {
    return {
      command: 'powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
    }
  }

  return {
    command: 'bash',
    args: ['-lc', script],
  }
}

function spawnScriptTask(label, script, extraEnv = {}, action = 'task') {
  const task = createTask(label, action)
  const shell = getShellCommand(script)
  const child = spawn(shell.command, shell.args, {
    cwd: APPLYPILOT_REPO,
    env: {
      ...process.env,
      APPLYPILOT_DIR: APPLYPILOT_HOME,
      ...extraEnv,
    },
  })

  child.stdout.on('data', (chunk) => appendTaskLog(task, chunk.toString('utf8')))
  child.stderr.on('data', (chunk) => appendTaskLog(task, chunk.toString('utf8')))

  child.on('close', (code) => {
    task.status = code === 0 ? 'completed' : 'failed'
    task.exitCode = code
    task.endedAt = new Date().toISOString()
  })

  child.on('error', (error) => {
    appendTaskLog(task, `\n${error.message}\n`)
    task.status = 'failed'
    task.endedAt = new Date().toISOString()
  })

  return task
}

function normalizeCsvText(value) {
  return value
    .split(/\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function buildProfilePayload(config) {
  const salaryExpectation = config.compensation.salaryExpectation.trim()
  const salaryRangeMin = config.compensation.salaryRangeMin.trim() || salaryExpectation
  const salaryRangeMax = config.compensation.salaryRangeMax.trim() || salaryExpectation

  return {
    personal: {
      full_name: config.personal.fullName.trim(),
      preferred_name: config.personal.preferredName.trim(),
      email: config.personal.email.trim(),
      password: config.personal.password,
      phone: config.personal.phone.trim(),
      address: config.personal.address.trim(),
      city: config.personal.city.trim(),
      province_state: config.personal.provinceState.trim(),
      country: config.personal.country.trim(),
      postal_code: config.personal.postalCode.trim(),
      linkedin_url: config.personal.linkedinUrl.trim(),
      github_url: config.personal.githubUrl.trim(),
      portfolio_url: config.personal.portfolioUrl.trim(),
      website_url: config.personal.websiteUrl.trim(),
    },
    work_authorization: {
      legally_authorized_to_work: config.workAuthorization.legallyAuthorizedToWork,
      require_sponsorship: config.workAuthorization.requireSponsorship,
      work_permit_type: config.workAuthorization.workPermitType.trim(),
    },
    availability: {
      earliest_start_date: config.availability.earliestStartDate.trim() || 'Immediately',
      available_for_full_time: 'Yes',
      available_for_contract: 'No',
    },
    compensation: {
      salary_expectation: salaryExpectation,
      salary_currency: config.compensation.salaryCurrency.trim() || 'USD',
      salary_range_min: salaryRangeMin,
      salary_range_max: salaryRangeMax,
      currency_conversion_note: '',
    },
    experience: {
      years_of_experience_total: config.experience.yearsOfExperienceTotal.trim(),
      education_level: config.experience.educationLevel.trim(),
      current_job_title: config.experience.currentJobTitle.trim(),
      current_company: '',
      target_role: config.experience.targetRole.trim(),
    },
    skills_boundary: {
      programming_languages: normalizeCsvText(config.skillsBoundary.programmingLanguages),
      frameworks: normalizeCsvText(config.skillsBoundary.frameworks),
      tools: normalizeCsvText(config.skillsBoundary.tools),
    },
    resume_facts: {
      preserved_companies: normalizeCsvText(config.resumeFacts.preservedCompanies),
      preserved_projects: normalizeCsvText(config.resumeFacts.preservedProjects),
      preserved_school: config.resumeFacts.preservedSchool.trim(),
      real_metrics: normalizeCsvText(config.resumeFacts.realMetrics),
    },
    eeo_voluntary: {
      gender: 'Decline to self-identify',
      race_ethnicity: 'Decline to self-identify',
      veteran_status: 'I am not a protected veteran',
      disability_status: 'I do not wish to answer',
    },
  }
}

function buildSearchConfigText(config) {
  const remoteOnly = Boolean(config.search.remoteOnly)
  const fallbackLocalLocation = [config.personal.city.trim(), config.personal.provinceState.trim()]
    .filter(Boolean)
    .join(', ')
  const location = remoteOnly
    ? 'Remote'
    : config.search.location.trim() || fallbackLocalLocation || 'San Francisco, CA'
  const distance = Number.parseInt(config.search.distance, 10)
  const cleanDistance = remoteOnly
    ? 0
    : Number.isFinite(distance) ? Math.max(distance, 0) : 25
  const queries = normalizeCsvText(config.search.queries)
  const searchQueries = queries.length ? queries : ['Software Engineer']

  const lines = [
    '# Generated by ApplyPilot Control Center',
    'defaults:',
    `  distance: ${cleanDistance}`,
    '  hours_old: 72',
    '  results_per_site: 50',
    '',
    'locations:',
    `  - label: "${escapeYaml(remoteOnly ? 'Remote' : location)}"`,
    `    location: "${escapeYaml(location)}"`,
    `    remote: ${String(remoteOnly).toLowerCase()}`,
    '',
    'queries:',
  ]

  searchQueries.forEach((query, index) => {
    lines.push(`  - query: "${escapeYaml(query)}"`)
    lines.push(`    tier: ${Math.min(index + 1, 3)}`)
  })

  return `${lines.join('\n')}\n`
}

function buildEnvText(config) {
  const lines = ['# Generated by ApplyPilot Control Center']
  const codexModel = config.ai?.model?.trim() || 'gpt-5.4'
  const capsolverKey = config.ai?.capsolverKey?.trim() || ''

  lines.push(`APPLYPILOT_CODEX_MODEL=${codexModel}`)

  if (capsolverKey) {
    lines.push(`CAPSOLVER_API_KEY=${capsolverKey}`)
  }

  return `${lines.join('\n')}\n`
}

function escapeYaml(value) {
  return String(value).replace(/"/g, '\\"')
}

function parseEnvContent(content) {
  const entries = {}

  content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .forEach((line) => {
      const [key, ...rest] = line.split('=')
      entries[key] = rest.join('=')
    })

  return entries
}

function parseSearchContent(content) {
  const queryMatches = [...content.matchAll(/-\s+query:\s+"?(.+?)"?\s*$/gm)].map((match) => match[1])
  const locationMatches = [...content.matchAll(/location:\s+"?(.+?)"?\s*$/gm)]
  const locationMatch = locationMatches[locationMatches.length - 1] ?? null
  const distanceMatch = content.match(/distance:\s+(\d+)/)
  const remoteMatch = content.match(/remote:\s+(true|false)/i)
  const remoteOnly = remoteMatch?.[1]?.toLowerCase() === 'true'
  const parsedLocation = locationMatch?.[1] ?? 'Remote'
  const cleanedLocation = normalizeSearchLocation(parsedLocation)
  const normalizedRemoteOnly = remoteOnly || (!cleanedLocation && /remote/i.test(parsedLocation))

  return {
    location: normalizedRemoteOnly ? '' : cleanedLocation,
    remoteOnly: normalizedRemoteOnly,
    distance: distanceMatch?.[1] ?? '0',
    queries: queryMatches.join('\n') || 'Software Engineer',
  }
}

function normalizeSearchLocation(location) {
  return String(location ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part && !/^remote(?:\s+only)?$/i.test(part))
    .join(', ')
}

async function pathExists(targetPath) {
  try {
    await access(targetPath, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

async function resolveChromePath() {
  const candidates = IS_WINDOWS
    ? [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(os.homedir(), 'AppData', 'Local', 'Chromium', 'Application', 'chrome.exe'),
      ]
    : [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
      ]

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate
    }
  }

  const pathChrome = await locateOnPath(IS_WINDOWS
    ? ['chrome.exe', 'chrome', 'chromium.exe', 'chromium']
    : ['google-chrome', 'chromium', 'chrome'])
  if (pathChrome) {
    return pathChrome
  }

  return resolvePlaywrightChromePath()
}

async function resolvePlaywrightChromePath() {
  if (!(await pathExists(PYTHON_BIN))) {
    return ''
  }

  const script = [
    'from pathlib import Path',
    'from playwright.sync_api import sync_playwright',
    'with sync_playwright() as playwright:',
    '    print(Path(playwright.chromium.executable_path))',
  ].join('\n')

  const result = await runProcessDetailed(PYTHON_BIN, ['-c', script])
  return result.code === 0 ? result.stdout : ''
}

async function resolveCodexStatus() {
  const codexPath = await locateOnPath(IS_WINDOWS ? ['codex.cmd', 'codex.exe', 'codex'] : ['codex'])
  if (!codexPath) {
    return { path: '', status: '' }
  }

  const loginProbe = await runProcessDetailed(codexPath, ['login', 'status'])

  return {
    path: codexPath,
    status: loginProbe.code === 0 ? loginProbe.stdout || loginProbe.stderr : '',
  }
}

async function resolveBootstrapPython() {
  const candidates = IS_WINDOWS
    ? [
        { command: 'py', args: ['-3.13'] },
        { command: 'py', args: ['-3.12'] },
        { command: 'py', args: ['-3.11'] },
        { command: 'python', args: [] },
        { command: 'py', args: ['-3'] },
      ]
    : [
        { command: 'python3.13', args: [] },
        { command: 'python3.12', args: [] },
        { command: 'python3.11', args: [] },
        { command: 'python3', args: [] },
      ]

  for (const candidate of candidates) {
    const versionProbe = await runProcessDetailed(candidate.command, [...candidate.args, '-c', 'import sys; print(".".join(map(str, sys.version_info[:3])))'])
    const versionOutput = versionProbe.code === 0 ? versionProbe.stdout : ''
    if (!versionOutput) {
      continue
    }

    const [major, minor] = versionOutput.split('.').map(Number)
    if (major > 3 || (major === 3 && minor >= 11)) {
      const binary = await locateOnPath([candidate.command])
      if (binary || candidate.command === 'py') {
        return {
          command: candidate.command,
          args: candidate.args,
          binary: binary || candidate.command,
          version: versionOutput,
        }
      }
    }
  }

  return { command: '', args: [], binary: '', version: '' }
}

async function runProcessDetailed(command, args = [], options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: options.env || process.env,
      cwd: options.cwd,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8')
    })
    child.on('close', (code) => {
      resolve({
        code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      })
    })
    child.on('error', () => {
      resolve({
        code: 1,
        stdout: '',
        stderr: '',
      })
    })
  })
}

async function runProbe(command, args = [], options = {}) {
  const result = await runProcessDetailed(command, args, options)
  return result.code === 0 ? result.stdout : ''
}

async function locateOnPath(candidates) {
  for (const candidate of candidates) {
    const locator = IS_WINDOWS ? 'where' : 'which'
    const result = await runProcessDetailed(locator, [candidate])
    if (result.code === 0 && result.stdout) {
      return result.stdout.split(/\r?\n/)[0].trim()
    }
  }

  return ''
}

async function readConfigBundle() {
  const profilePath = path.join(APPLYPILOT_HOME, 'profile.json')
  const searchesPath = path.join(APPLYPILOT_HOME, 'searches.yaml')
  const envPath = path.join(APPLYPILOT_HOME, '.env')
  const resumePdfPath = path.join(APPLYPILOT_HOME, 'resume.pdf')
  const resumeTextPath = path.join(APPLYPILOT_HOME, 'resume.txt')

  const profileExists = await pathExists(profilePath)
  const searchesExists = await pathExists(searchesPath)
  const envExists = await pathExists(envPath)
  const resumePdfExists = await pathExists(resumePdfPath)
  const resumeTextExists = await pathExists(resumeTextPath)

  const profile = profileExists
    ? JSON.parse(await readFile(profilePath, 'utf8'))
    : null
  const searches = searchesExists
    ? parseSearchContent(await readFile(searchesPath, 'utf8'))
    : null
  const env = envExists
    ? parseEnvContent(await readFile(envPath, 'utf8'))
    : {}

  return {
    resumePdfName: resumePdfExists ? path.basename(resumePdfPath) : '',
    resumeTextName: resumeTextExists ? path.basename(resumeTextPath) : '',
    personal: {
      fullName: profile?.personal?.full_name ?? '',
      preferredName: profile?.personal?.preferred_name ?? '',
      email: profile?.personal?.email ?? '',
      password: profile?.personal?.password ?? '',
      phone: profile?.personal?.phone ?? '',
      address: profile?.personal?.address ?? '',
      city: profile?.personal?.city ?? '',
      provinceState: profile?.personal?.province_state ?? '',
      country: profile?.personal?.country ?? 'United States',
      postalCode: profile?.personal?.postal_code ?? '',
      linkedinUrl: profile?.personal?.linkedin_url ?? '',
      githubUrl: profile?.personal?.github_url ?? '',
      portfolioUrl: profile?.personal?.portfolio_url ?? '',
      websiteUrl: profile?.personal?.website_url ?? '',
    },
    workAuthorization: {
      legallyAuthorizedToWork: stringifyYesNo(profile?.work_authorization?.legally_authorized_to_work, 'Yes'),
      requireSponsorship: stringifyYesNo(profile?.work_authorization?.require_sponsorship, 'No'),
      workPermitType: profile?.work_authorization?.work_permit_type ?? '',
    },
    compensation: {
      salaryExpectation: profile?.compensation?.salary_expectation ?? '',
      salaryCurrency: profile?.compensation?.salary_currency ?? 'USD',
      salaryRangeMin: profile?.compensation?.salary_range_min ?? '',
      salaryRangeMax: profile?.compensation?.salary_range_max ?? '',
    },
    experience: {
      yearsOfExperienceTotal: profile?.experience?.years_of_experience_total ?? '',
      educationLevel: profile?.experience?.education_level ?? '',
      currentJobTitle: profile?.experience?.current_job_title ?? '',
      targetRole: profile?.experience?.target_role ?? '',
    },
    skillsBoundary: {
      programmingLanguages: (profile?.skills_boundary?.programming_languages ?? profile?.skills_boundary?.languages ?? []).join(', '),
      frameworks: (profile?.skills_boundary?.frameworks ?? []).join(', '),
      tools: (profile?.skills_boundary?.tools ?? []).join(', '),
    },
    resumeFacts: {
      preservedCompanies: (profile?.resume_facts?.preserved_companies ?? []).join(', '),
      preservedProjects: (profile?.resume_facts?.preserved_projects ?? []).join(', '),
      preservedSchool: profile?.resume_facts?.preserved_school ?? '',
      realMetrics: (profile?.resume_facts?.real_metrics ?? []).join(', '),
    },
    availability: {
      earliestStartDate: profile?.availability?.earliest_start_date ?? 'Immediately',
    },
    ai: {
      provider: 'codex',
      apiKey: '',
      model: env.APPLYPILOT_CODEX_MODEL ?? 'gpt-5.4',
      localUrl: '',
      capsolverKey: env.CAPSOLVER_API_KEY ?? '',
    },
    search: searches ?? {
      location: '',
      remoteOnly: true,
      distance: '0',
      queries: 'Software Engineer',
    },
  }
}

function stringifyYesNo(value, fallback) {
  if (value === true) {
    return 'Yes'
  }
  if (value === false) {
    return 'No'
  }
  if (value === 'Yes' || value === 'No') {
    return value
  }
  return fallback
}

async function readPipelineStats() {
  const dbPath = path.join(APPLYPILOT_HOME, 'applypilot.db')
  if (!(await pathExists(PYTHON_BIN)) || !(await pathExists(dbPath))) {
    return null
  }

  const script = `
import json, os, sys
sys.path.insert(0, ${JSON.stringify(path.join(APPLYPILOT_REPO, 'src'))})
os.environ["APPLYPILOT_DIR"] = ${JSON.stringify(APPLYPILOT_HOME)}
from applypilot.config import load_env
from applypilot.database import init_db, get_stats
load_env()
init_db()
print(json.dumps(get_stats()))
`

  return new Promise((resolve) => {
    const child = spawn(PYTHON_BIN, ['-c', script], {
      cwd: APPLYPILOT_REPO,
      env: {
        ...process.env,
        APPLYPILOT_DIR: APPLYPILOT_HOME,
        PYTHONPATH: path.join(APPLYPILOT_REPO, 'src'),
      },
    })
    let stdout = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8')
    })
    child.on('close', () => {
      try {
        resolve(stdout.trim() ? JSON.parse(stdout.trim()) : null)
      } catch {
        resolve(null)
      }
    })
    child.on('error', () => resolve(null))
  })
}

function deriveWorkflow(readiness, stats) {
  if (!readiness.resumeTextReady || !readiness.configFilesReady) {
    return {
      stage: 'setup',
      title: 'Save setup',
      detail: 'Finish the form and save the profile, searches, and plain-text resume. The PDF resume is optional.',
    }
  }

  if (!readiness.pythonReady) {
    return {
      stage: 'install',
      title: 'Install ApplyPilot',
      detail: 'Bootstrap the Python environment and browser dependencies.',
    }
  }

  if (!readiness.codexReady || !readiness.chromeReady) {
    return {
      stage: 'requirements',
      title: 'Fix local requirements',
      detail: 'Codex must be logged in and a browser must be available before auto-apply can run.',
    }
  }

  if (!stats || stats.total === 0) {
    return {
      stage: 'pipeline',
      title: 'Start job search',
      detail: 'Run the pipeline to discover and prepare matching applications.',
    }
  }

  if (stats.ready_to_apply > 0) {
    return {
      stage: 'apply',
      title: 'Start applying',
      detail: `${stats.ready_to_apply} applications are prepared and ready to submit.`,
    }
  }

  return {
    stage: 'pipeline',
    title: 'Continue pipeline',
    detail: 'Keep preparing applications until tailored resumes are ready.',
  }
}

async function buildStatePayload() {
  const bootstrapPython = await resolveBootstrapPython()
  const config = await readConfigBundle()
  const pythonReady = await pathExists(PYTHON_BIN)
  const pipReady = await pathExists(PIP_BIN)
  const profileReady = await pathExists(path.join(APPLYPILOT_HOME, 'profile.json'))
  const searchesReady = await pathExists(path.join(APPLYPILOT_HOME, 'searches.yaml'))
  const envReady = await pathExists(path.join(APPLYPILOT_HOME, '.env'))
  const resumePdfReady = await pathExists(path.join(APPLYPILOT_HOME, 'resume.pdf'))
  const resumeTextReady = await pathExists(path.join(APPLYPILOT_HOME, 'resume.txt'))
  const codex = await resolveCodexStatus()
  const nodePath = await locateOnPath(IS_WINDOWS ? ['node.exe', 'node'] : ['node'])
  const chromePath = await resolveChromePath()
  const stats = await readPipelineStats()

  const readiness = {
    pythonReady,
    pipReady,
    codexReady: Boolean(codex.status),
    nodeReady: Boolean(nodePath),
    chromeReady: Boolean(chromePath),
    configFilesReady: profileReady && searchesReady && envReady,
    resumeReady: resumeTextReady,
    resumeTextReady,
    resumePdfReady,
    profileReady,
    searchesReady,
    envReady,
    defaultMinScore: '7',
  }

  return {
    message: 'ApplyPilot Control Center is ready.',
    config,
    system: {
      paths: {
        applypilotRepo: APPLYPILOT_REPO,
        applypilotHome: APPLYPILOT_HOME,
        controlCenter: CONTROL_CENTER_DIR,
      },
      readiness,
      stats,
      workflow: deriveWorkflow(readiness, stats),
      binaries: {
        python: pythonReady ? PYTHON_BIN : '',
        pip: pipReady ? PIP_BIN : '',
        bootstrapPython: bootstrapPython.binary,
        codex: codex.path,
        codexStatus: codex.status,
        node: nodePath,
        chrome: chromePath,
      },
    },
  }
}

async function saveConfigBundle(payload) {
  await mkdir(APPLYPILOT_HOME, { recursive: true })
  await writeFile(
    path.join(APPLYPILOT_HOME, 'profile.json'),
    JSON.stringify(buildProfilePayload(payload), null, 2),
    'utf8',
  )
  await writeFile(
    path.join(APPLYPILOT_HOME, 'searches.yaml'),
    buildSearchConfigText(payload),
    'utf8',
  )
  await writeFile(
    path.join(APPLYPILOT_HOME, '.env'),
    buildEnvText(payload),
    'utf8',
  )

  if (payload.resumePdfBase64) {
    await writeFile(
      path.join(APPLYPILOT_HOME, 'resume.pdf'),
      Buffer.from(payload.resumePdfBase64, 'base64'),
    )
  }

  if (payload.resumeTextBase64) {
    await writeFile(
      path.join(APPLYPILOT_HOME, 'resume.txt'),
      Buffer.from(payload.resumeTextBase64, 'base64'),
    )
  }
}

function bootstrapScript() {
  if (IS_WINDOWS) {
    return `
$ErrorActionPreference = 'Stop'
Set-Location ${shellQuote(APPLYPILOT_REPO)}

$bootstrap = $null
$candidates = @(
  @{ Command = 'py'; Args = @('-3.13') },
  @{ Command = 'py'; Args = @('-3.12') },
  @{ Command = 'py'; Args = @('-3.11') },
  @{ Command = 'python'; Args = @() },
  @{ Command = 'py'; Args = @('-3') }
)

foreach ($candidate in $candidates) {
  try {
    $version = & $candidate.Command @($candidate.Args + @('-c', 'import sys; print(".".join(map(str, sys.version_info[:3])))')) 2>$null
    if ($LASTEXITCODE -eq 0 -and $version) {
      $parts = $version.Trim().Split('.')
      if (([int]$parts[0] -gt 3) -or (([int]$parts[0] -eq 3) -and ([int]$parts[1] -ge 11))) {
        $bootstrap = $candidate
        break
      }
    }
  } catch {}
}

if (-not $bootstrap) {
  throw 'No Python 3.11+ interpreter found.'
}

if (Test-Path '.venv\\Scripts\\python.exe') {
  $venvOk = $false
  try {
    & '.venv\\Scripts\\python.exe' -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)'
    $venvOk = ($LASTEXITCODE -eq 0)
  } catch {
    $venvOk = $false
  }
  if (-not $venvOk) {
    Remove-Item -Recurse -Force '.venv'
  }
}

& $bootstrap.Command @($bootstrap.Args + @('-m', 'venv', '.venv'))
$python = (Resolve-Path '.venv\\Scripts\\python.exe').Path
& $python -m pip install -U pip
& $python -m pip install -e .
& $python -m pip install --no-deps python-jobspy
& $python -m pip install pydantic tls-client requests markdownify regex
& $python -m playwright install chromium
Write-Host ""
Write-Host "Bootstrap complete."
`
  }

  return `
set -euo pipefail
cd ${shellQuote(APPLYPILOT_REPO)}
PYTHON_BOOTSTRAP="$(command -v python3.13 || command -v python3.12 || command -v python3.11 || command -v python3 || true)"
if [ -z "$PYTHON_BOOTSTRAP" ]; then
  echo "No Python 3.11+ interpreter found."
  exit 1
fi
"$PYTHON_BOOTSTRAP" - <<'PY'
import sys
if sys.version_info < (3, 11):
    raise SystemExit("ApplyPilot needs Python 3.11+.")
PY
if [ -x .venv/bin/python ]; then
  if ! .venv/bin/python - <<'PY'
import sys
raise SystemExit(0 if sys.version_info >= (3, 11) else 1)
PY
  then
    rm -rf .venv
  fi
fi
"${PYTHON_BOOTSTRAP}" -m venv .venv
${shellQuote(PYTHON_BIN)} -m pip install -U pip
${shellQuote(PYTHON_BIN)} -m pip install -e .
${shellQuote(PYTHON_BIN)} -m pip install --no-deps python-jobspy
${shellQuote(PYTHON_BIN)} -m pip install pydantic tls-client requests markdownify regex
${shellQuote(PYTHON_BIN)} -m playwright install chromium
printf '\\nBootstrap complete.\\n'
`
}

function applypilotCommand(args) {
  const formattedArgs = args.map((arg) => shellQuote(arg)).join(' ')

  if (IS_WINDOWS) {
    return `
$ErrorActionPreference = 'Stop'
Set-Location ${shellQuote(APPLYPILOT_REPO)}
$env:APPLYPILOT_DIR = ${shellQuote(APPLYPILOT_HOME)}
& ${shellQuote(PYTHON_BIN)} -m applypilot ${formattedArgs}
`
  }

  return `
set -euo pipefail
cd ${shellQuote(APPLYPILOT_REPO)}
export APPLYPILOT_DIR=${shellQuote(APPLYPILOT_HOME)}
${shellQuote(PYTHON_BIN)} -m applypilot ${formattedArgs}
`
}

function taskFromAction(action, options) {
  if (action === 'bootstrap') {
    return {
      label: 'Install or repair ApplyPilot',
      script: bootstrapScript(),
      action,
    }
  }

  if (action === 'doctor') {
    return {
      label: 'ApplyPilot doctor',
      script: applypilotCommand(['doctor']),
      action,
    }
  }

  if (action === 'status') {
    return {
      label: 'ApplyPilot status',
      script: applypilotCommand(['status']),
      action,
    }
  }

  if (action === 'dashboard') {
    return {
      label: 'Build ApplyPilot dashboard',
      script: applypilotCommand(['dashboard']),
      action,
    }
  }

  if (action === 'run') {
    const args = ['run', '--min-score', safeInt(options.minScore, 7), '--workers', safeInt(options.workers, 1)]
    if (options.continuous) {
      args.push('--stream')
    }
    return {
      label: 'Run ApplyPilot pipeline',
      script: applypilotCommand(args),
      action,
    }
  }

  if (action === 'applyDryRun' || action === 'applyLive') {
    const args = [
      'apply',
      '--min-score',
      safeInt(options.minScore, 7),
      '--workers',
      safeInt(options.workers, 1),
    ]
    if (options.limit && Number(options.limit) > 0) {
      args.push('--limit', safeInt(options.limit, 1))
    }
    if (options.headless) {
      args.push('--headless')
    }
    if (action === 'applyDryRun') {
      args.push('--dry-run')
    }
    if (options.targetUrl?.trim()) {
      args.push('--url', options.targetUrl.trim())
    }

    return {
      label: action === 'applyDryRun' ? 'ApplyPilot auto-apply dry run' : 'ApplyPilot auto-apply live',
      script: applypilotCommand(args),
      action,
    }
  }

  throw new Error(`Unsupported task action: ${action}`)
}

function safeInt(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return String(Number.isFinite(parsed) && parsed > 0 ? parsed : fallback)
}

function shellQuote(value) {
  if (IS_WINDOWS) {
    return `'${String(value).replace(/'/g, "''")}'`
  }

  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

async function serveStaticAsset(req, res, requestPathname) {
  const safePath = requestPathname === '/' ? '/index.html' : requestPathname
  const resolvedPath = path.join(DIST_DIR, safePath)

  try {
    const fileBuffer = await readFile(resolvedPath)
    const ext = path.extname(resolvedPath)
    const mimeType = MIME_TYPES[ext] || 'application/octet-stream'
    res.writeHead(200, { 'Content-Type': mimeType })
    res.end(fileBuffer)
    return true
  } catch {
    if (!safePath.endsWith('.html')) {
      return false
    }
  }

  try {
    const fallback = await readFile(path.join(DIST_DIR, 'index.html'))
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(fallback)
    return true
  } catch {
    return false
  }
}

const server = createServer(async (req, res) => {
  if (!req.url || !req.method) {
    jsonResponse(res, 400, { error: 'Invalid request.' })
    return
  }

  if (req.method === 'OPTIONS') {
    jsonResponse(res, 200, { ok: true })
    return
  }

  const requestUrl = new URL(req.url, APP_URL)

  if (req.method === 'GET' && requestUrl.pathname === '/api/state') {
    jsonResponse(res, 200, await buildStatePayload())
    return
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/config') {
    try {
      const payload = await readJsonBody(req)
      await saveConfigBundle(payload)
      jsonResponse(res, 200, {
        message: 'Setup files saved to ~/.applypilot.',
        ...(await buildStatePayload()),
      })
    } catch (error) {
      jsonResponse(res, 500, {
        error: error instanceof Error ? error.message : 'Could not save setup files.',
      })
    }
    return
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/tasks') {
    try {
      const body = await readJsonBody(req)
      const taskConfig = taskFromAction(body.action, body.options || {})
      const task = spawnScriptTask(taskConfig.label, taskConfig.script, {}, taskConfig.action)
      jsonResponse(res, 200, { task: taskSummary(task) })
    } catch (error) {
      jsonResponse(res, 400, {
        error: error instanceof Error ? error.message : 'Could not start task.',
      })
    }
    return
  }

  if (req.method === 'GET' && requestUrl.pathname.startsWith('/api/tasks/')) {
    const taskId = requestUrl.pathname.split('/').pop()
    const task = taskId ? tasks.get(taskId) : null
    if (!task) {
      jsonResponse(res, 404, { error: 'Task not found.' })
      return
    }
    jsonResponse(res, 200, { task: taskSummary(task) })
    return
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/open') {
    const openScript = IS_WINDOWS
      ? `Start-Process ${shellQuote(APP_URL)}`
      : process.platform === 'darwin'
        ? `open ${shellQuote(APP_URL)}`
        : `xdg-open ${shellQuote(APP_URL)}`
    const task = spawnScriptTask('Open ApplyPilot Control Center', openScript, {}, 'open')
    jsonResponse(res, 200, {
      message: 'Opened the control center in your default browser.',
      task: taskSummary(task),
    })
    return
  }

  if (await serveStaticAsset(req, res, requestUrl.pathname)) {
    return
  }

  jsonResponse(res, 404, { error: 'Route not found.' })
})

server.listen(PORT, HOST, () => {
  console.log(`ApplyPilot Control Center listening on ${APP_URL}`)
})
