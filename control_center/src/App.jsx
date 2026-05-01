import { startTransition, useEffect, useMemo, useState } from 'react'
import './App.css'

const emptyConfig = {
  resumePdfName: '',
  resumeTextName: '',
  personal: {
    fullName: '',
    preferredName: '',
    email: '',
    password: '',
    phone: '',
    address: '',
    city: '',
    provinceState: '',
    country: 'United States',
    postalCode: '',
    linkedinUrl: '',
    githubUrl: '',
    portfolioUrl: '',
    websiteUrl: '',
  },
  workAuthorization: {
    legallyAuthorizedToWork: 'Yes',
    requireSponsorship: 'No',
    workPermitType: '',
  },
  compensation: {
    salaryExpectation: '',
    salaryCurrency: 'USD',
    salaryRangeMin: '',
    salaryRangeMax: '',
  },
  experience: {
    yearsOfExperienceTotal: '',
    educationLevel: '',
    currentJobTitle: '',
    targetRole: '',
  },
  skillsBoundary: {
    programmingLanguages: '',
    frameworks: '',
    tools: '',
  },
  resumeFacts: {
    preservedCompanies: '',
    preservedProjects: '',
    preservedSchool: '',
    realMetrics: '',
  },
  availability: {
    earliestStartDate: 'Immediately',
  },
  ai: {
    model: 'gpt-5.4',
    capsolverKey: '',
  },
  search: {
    location: '',
    remoteOnly: true,
    distance: '0',
    queries: 'Software Engineer',
  },
}

const emptyReadiness = {
  pythonReady: false,
  codexReady: false,
  chromeReady: false,
  configFilesReady: false,
  resumeReady: false,
  resumeTextReady: false,
  resumePdfReady: false,
  defaultMinScore: '7',
}

const emptyWorkflow = {
  stage: 'setup',
  title: 'Save setup',
  detail: 'Fill in the form and save the local files.',
}

const stepOrder = ['setup', 'install', 'pipeline', 'apply']
const emptySetupSnapshot = snapshotSetupConfig(emptyConfig)

function App() {
  const [state, setState] = useState({
    loading: true,
    saving: false,
    launching: false,
    actionRunning: false,
    error: '',
    message: '',
    system: null,
    config: emptyConfig,
    savedSetupSnapshot: emptySetupSnapshot,
    currentTaskId: null,
    currentTask: null,
  })
  const [setupPanelOpen, setSetupPanelOpen] = useState(true)
  const [activeSetupStep, setActiveSetupStep] = useState('profile')
  const [resumeFiles, setResumeFiles] = useState({ pdf: null, text: null })
  const [runOptions, setRunOptions] = useState({
    minScore: '7',
    workers: '1',
  })
  const [applyOptions, setApplyOptions] = useState({
    minScore: '7',
    workers: '1',
    limit: '5',
    headless: false,
    targetUrl: '',
  })

  const readiness = state.system?.readiness ?? emptyReadiness
  const stats = state.system?.stats ?? null
  const workflow = state.system?.workflow ?? emptyWorkflow
  const currentTask = state.currentTask
  const activeStepId = workflow.stage === 'requirements' ? 'install' : workflow.stage
  const setupSnapshot = useMemo(() => snapshotSetupConfig(state.config), [state.config])
  const setupIsSaved = setupSnapshot === state.savedSetupSnapshot
  const profileIsComplete = useMemo(() => isProfileComplete(state.config), [state.config])
  const searchIsComplete = useMemo(() => isSearchComplete(state.config), [state.config])
  const setupIsComplete = profileIsComplete && searchIsComplete && readiness.resumeTextReady
  const setupSummary = useMemo(() => buildSetupSummary(state.config), [state.config])

  useEffect(() => {
    let cancelled = false

    async function loadState() {
      try {
        const response = await fetch('/api/state')
        const payload = await response.json()

        if (cancelled) {
          return
        }

        startTransition(() => {
          setState((current) => ({
            ...current,
            loading: false,
            error: '',
            system: payload.system,
            config: payload.config,
            savedSetupSnapshot: snapshotSetupConfig(payload.config),
            message: '',
          }))
          setRunOptions((current) => ({
            ...current,
            minScore: payload.system.readiness.defaultMinScore,
          }))
          setApplyOptions((current) => ({
            ...current,
            minScore: payload.system.readiness.defaultMinScore,
          }))
        })
      } catch (error) {
        if (cancelled) {
          return
        }

        setState((current) => ({
          ...current,
          loading: false,
          error: error instanceof Error ? error.message : 'Failed to load control center.',
        }))
      }
    }

    void loadState()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!state.currentTaskId) {
      return undefined
    }

    let cancelled = false
    let timer = 0

    const refreshState = async (finishedTask) => {
      const response = await fetch('/api/state')
      const payload = await response.json()

      if (cancelled) {
        return
      }

      setState((current) => ({
        ...current,
        system: payload.system,
        config: payload.config,
        savedSetupSnapshot: snapshotSetupConfig(payload.config),
        message: finishedTask?.status === 'completed' ? `${finishedTask.label} finished.` : current.message,
        error: finishedTask?.status === 'failed' ? `${finishedTask.label} failed. Check the log output below.` : current.error,
        actionRunning: false,
      }))
    }

    const pollTask = async () => {
      try {
        const response = await fetch(`/api/tasks/${state.currentTaskId}`)
        const payload = await response.json()

        if (cancelled) {
          return
        }

        setState((current) => ({
          ...current,
          currentTask: payload.task,
          actionRunning: payload.task.status === 'running',
        }))

        if (payload.task.status !== 'running') {
          window.clearInterval(timer)
          await refreshState(payload.task)
        }
      } catch {
        if (!cancelled) {
          setState((current) => ({
            ...current,
            actionRunning: false,
            currentTask: current.currentTask
              ? {
                  ...current.currentTask,
                  status: 'failed',
                  logs: `${current.currentTask.logs}\nFailed to refresh live logs.`,
                }
              : null,
          }))
        }
      }
    }

    void pollTask()
    timer = window.setInterval(() => {
      void pollTask()
    }, 1200)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [state.currentTaskId])

  useEffect(() => {
    if (setupIsComplete && setupIsSaved) {
      setSetupPanelOpen(false)
      return
    }

    setSetupPanelOpen(true)
  }, [setupIsComplete, setupIsSaved])

  const setupCompletion = useMemo(() => {
    const checks = [
      readiness.resumeTextReady,
      readiness.configFilesReady,
      readiness.pythonReady,
      readiness.codexReady,
      readiness.chromeReady,
    ]
    const completed = checks.filter(Boolean).length
    return Math.round((completed / checks.length) * 100)
  }, [readiness])

  const stepStatuses = useMemo(() => {
    const completed = {
      setup: readiness.resumeTextReady && readiness.configFilesReady,
      install: readiness.pythonReady,
      pipeline: Boolean(stats && stats.total > 0),
      apply: Boolean(stats && stats.ready_to_apply > 0),
    }

    const activeIndex = stepOrder.indexOf(activeStepId)
    return stepOrder.map((step, index) => ({
      id: step,
      status: completed[step] ? 'done' : index === activeIndex ? 'active' : 'pending',
    }))
  }, [activeStepId, readiness, stats])

  const nextAction = (() => {
    if (workflow.stage === 'setup') {
      return {
        label: state.saving ? 'Saving setup…' : 'Save setup',
        helper: 'This writes the profile, resume, and search files into ~/.applypilot.',
        onClick: saveSetup,
        disabled: state.saving,
      }
    }

    if (workflow.stage === 'install') {
      return {
        label: state.actionRunning ? 'Installing…' : 'Install or repair ApplyPilot',
        helper: 'This creates the Python environment, installs the package, and installs Playwright Chromium.',
        onClick: () => startTask('bootstrap'),
        disabled: state.actionRunning,
      }
    }

    if (workflow.stage === 'requirements') {
      return {
        label: state.actionRunning ? 'Checking…' : 'Check local requirements',
        helper: 'Run doctor to see whether Codex needs login or a browser still needs to be installed.',
        onClick: () => startTask('doctor'),
        disabled: state.actionRunning,
      }
    }

    if (workflow.stage === 'apply') {
      return {
        label: state.actionRunning ? 'Applying…' : 'Start applying',
        helper: 'Use the prepared materials to begin autonomous applications.',
        onClick: () => startTask('applyLive', applyOptions),
        disabled: state.actionRunning,
      }
    }

    return {
      label: state.actionRunning ? 'Running pipeline…' : 'Start job search',
      helper: 'This discovers jobs, enriches them, scores them, tailors resumes, and prepares applications.',
      onClick: () => startTask('run', runOptions),
      disabled: state.actionRunning,
    }
  })()

  function setConfigField(section, key, value) {
    setState((current) => ({
      ...current,
      config: {
        ...current.config,
        [section]: {
          ...current.config[section],
          [key]: value,
        },
      },
    }))
  }

  function setTopLevelConfig(key, value) {
    setState((current) => ({
      ...current,
      config: {
        ...current.config,
        [key]: value,
      },
    }))
  }

  async function saveSetup() {
    setState((current) => ({ ...current, saving: true, error: '', message: '' }))

    try {
      const payload = {
        ...state.config,
        resumePdfBase64: resumeFiles.pdf ? await readFileAsBase64(resumeFiles.pdf) : null,
        resumeTextBase64: resumeFiles.text ? await readFileAsBase64(resumeFiles.text) : null,
      }

      const response = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Could not save setup.')
      }

      setResumeFiles({ pdf: null, text: null })
      setState((current) => ({
        ...current,
        saving: false,
        error: '',
        message: result.message,
        system: result.system,
        config: result.config,
        savedSetupSnapshot: snapshotSetupConfig(result.config),
      }))
    } catch (error) {
      setState((current) => ({
        ...current,
        saving: false,
        error: error instanceof Error ? error.message : 'Could not save setup.',
      }))
    }
  }

  async function startTask(action, options = {}) {
    setState((current) => ({
      ...current,
      error: '',
      message: '',
      actionRunning: true,
    }))

    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, options }),
      })
      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Could not start task.')
      }

      setState((current) => ({
        ...current,
        currentTaskId: result.task.id,
        currentTask: result.task,
        actionRunning: true,
      }))
    } catch (error) {
      setState((current) => ({
        ...current,
        actionRunning: false,
        error: error instanceof Error ? error.message : 'Could not start task.',
      }))
    }
  }

  async function launchBrowser() {
    setState((current) => ({ ...current, launching: true, error: '' }))

    try {
      const response = await fetch('/api/open', { method: 'POST' })
      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Could not open browser.')
      }

      setState((current) => ({
        ...current,
        launching: false,
        message: result.message,
      }))
    } catch (error) {
      setState((current) => ({
        ...current,
        launching: false,
        error: error instanceof Error ? error.message : 'Could not open browser.',
      }))
    }
  }

  if (state.loading) {
    return (
      <div className="loading-shell">
        <div className="loading-card">
          <p className="kicker">ApplyPilot Control Center</p>
          <h1>Loading local setup</h1>
          <p>Checking the repo, Python environment, and existing ApplyPilot files.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="control-shell">
      <aside className="control-sidebar">
        <div className="brand-lockup">
          <p className="kicker">Family-friendly launcher</p>
          <h1>ApplyPilot, without the terminal</h1>
          <p className="lede">
            Save the candidate details once, install the tooling once, then
            follow the next-step buttons from setup to job prep to auto-apply.
          </p>
        </div>

        <section className="sidebar-card">
          <div className="card-header">
            <h2>Progress</h2>
            <span className="score-badge">{setupCompletion}%</span>
          </div>
          <div className="progress-rail">
            <div className="progress-fill" style={{ width: `${setupCompletion}%` }} />
          </div>
          <div className="step-stack">
            {stepStatuses.map((step, index) => (
              <div key={step.id} className={`step-chip step-chip-${step.status}`}>
                <span>{index + 1}</span>
                <strong>{formatStepName(step.id)}</strong>
              </div>
            ))}
          </div>
          <ul className="checklist">
            <StatusItem label="Resume text saved" ready={readiness.resumeTextReady} />
            <StatusItem label="Resume PDF saved" ready={readiness.resumePdfReady} optional />
            <StatusItem label="Profile and search files saved" ready={readiness.configFilesReady} />
            <StatusItem label="ApplyPilot installed" ready={readiness.pythonReady} />
            <StatusItem label="Codex login ready" ready={readiness.codexReady} />
            <StatusItem label="Browser ready" ready={readiness.chromeReady} />
          </ul>
        </section>

        <section className="sidebar-card">
          <div className="card-header">
            <h2>Quick launch</h2>
          </div>
          <button
            className="secondary-action"
            type="button"
            onClick={launchBrowser}
            disabled={state.launching}
          >
            {state.launching ? 'Opening…' : 'Open this app in browser'}
          </button>
          <button
            className="ghost-action"
            type="button"
            onClick={() => startTask('doctor')}
            disabled={state.actionRunning}
          >
            Run doctor
          </button>
        </section>

        <section className="sidebar-card">
          <div className="card-header">
            <h2>System</h2>
          </div>
          <dl className="path-list">
            <div>
              <dt>ApplyPilot repo</dt>
              <dd>{state.system.paths.applypilotRepo}</dd>
            </div>
            <div>
              <dt>Local data</dt>
              <dd>{state.system.paths.applypilotHome}</dd>
            </div>
            <div>
              <dt>Launcher app</dt>
              <dd>{state.system.paths.controlCenter}</dd>
            </div>
          </dl>
        </section>
      </aside>

      <main className="control-main">
        <section className="hero-panel">
          <div className="hero-copy">
            <p className="kicker">Next step</p>
            <h2>{workflow.title}</h2>
            <p>{workflow.detail}</p>
            <p className="codex-note">
              Codex now handles the text generation stages too, so this launcher
              no longer asks for Gemini or OpenAI API keys.
            </p>
          </div>

          <div className="hero-cta">
            <button className="primary-action primary-action-large" type="button" onClick={nextAction.onClick} disabled={nextAction.disabled}>
              {nextAction.label}
            </button>
            <p className="panel-note">{nextAction.helper}</p>
          </div>
        </section>

        {(state.message || state.error) && (
          <section className={`notice ${state.error ? 'notice-error' : 'notice-success'}`}>
            {state.error || state.message}
          </section>
        )}

        <section className="stats-strip">
          <MetricCard label="Jobs found" value={stats?.total ?? 0} />
          <MetricCard label="With descriptions" value={stats?.with_description ?? 0} />
          <MetricCard label="Tailored resumes" value={stats?.tailored ?? 0} />
          <MetricCard label="Ready to apply" value={stats?.ready_to_apply ?? 0} />
          <MetricCard label="Applied" value={stats?.applied ?? 0} />
        </section>

        <section className="workspace-grid">
          <section className="panel panel-wide collapsible-panel">
            <button className="collapsible-summary setup-summary-button" type="button" onClick={() => setSetupPanelOpen((current) => !current)}>
              <div>
                <p className="kicker">Setup</p>
                <h2>Steps 1, 2, and 3</h2>
                <p className="collapsible-summary-text">{setupSummary}</p>
              </div>
              <div className="collapsible-summary-meta">
                {setupIsSaved && setupIsComplete ? <span className="summary-badge">Saved</span> : null}
                {!setupIsSaved ? <span className="summary-badge summary-badge-warn">Editing</span> : null}
                <span className="summary-toggle">{setupPanelOpen ? 'Hide' : 'Show'}</span>
              </div>
            </button>

            {setupPanelOpen ? (
              <div className="collapsible-body">
                <div className="setup-step-tabs" role="tablist" aria-label="Setup steps">
                  <SetupStepTab
                    step="1"
                    title="Candidate details"
                    active={activeSetupStep === 'profile'}
                    onClick={() => setActiveSetupStep('profile')}
                  />
                  <SetupStepTab
                    step="2"
                    title="Resume files"
                    active={activeSetupStep === 'resume'}
                    onClick={() => setActiveSetupStep('resume')}
                  />
                  <SetupStepTab
                    step="3"
                    title="Search setup"
                    active={activeSetupStep === 'search'}
                    onClick={() => setActiveSetupStep('search')}
                  />
                </div>

                {activeSetupStep === 'profile' ? (
                  <article className="panel-subsection panel-subsection-setup">
                    <div className="section-block">
                      <h3>Contact and login</h3>
                      <div className="form-grid">
                        <Field label="Full name" value={state.config.personal.fullName} onChange={(value) => setConfigField('personal', 'fullName', value)} />
                        <Field label="Preferred name" value={state.config.personal.preferredName} onChange={(value) => setConfigField('personal', 'preferredName', value)} />
                        <Field label="Email" value={state.config.personal.email} onChange={(value) => setConfigField('personal', 'email', value)} />
                        <Field label="Job-site password" type="password" value={state.config.personal.password} onChange={(value) => setConfigField('personal', 'password', value)} />
                        <Field label="Phone" value={state.config.personal.phone} onChange={(value) => setConfigField('personal', 'phone', value)} />
                        <Field label="Address" value={state.config.personal.address} onChange={(value) => setConfigField('personal', 'address', value)} />
                        <Field label="City" value={state.config.personal.city} onChange={(value) => setConfigField('personal', 'city', value)} />
                        <Field label="State / province" value={state.config.personal.provinceState} onChange={(value) => setConfigField('personal', 'provinceState', value)} />
                        <Field label="Country" value={state.config.personal.country} onChange={(value) => setConfigField('personal', 'country', value)} />
                        <Field label="Postal code" value={state.config.personal.postalCode} onChange={(value) => setConfigField('personal', 'postalCode', value)} />
                        <Field label="LinkedIn URL" value={state.config.personal.linkedinUrl} onChange={(value) => setConfigField('personal', 'linkedinUrl', value)} />
                        <Field label="GitHub URL" value={state.config.personal.githubUrl} onChange={(value) => setConfigField('personal', 'githubUrl', value)} />
                        <Field label="Portfolio URL" value={state.config.personal.portfolioUrl} onChange={(value) => setConfigField('personal', 'portfolioUrl', value)} />
                        <Field label="Website URL" value={state.config.personal.websiteUrl} onChange={(value) => setConfigField('personal', 'websiteUrl', value)} />
                      </div>
                    </div>

                    <div className="section-block">
                      <h3>Eligibility and compensation</h3>
                      <div className="form-grid">
                        <SelectField
                          label="Authorized to work"
                          value={state.config.workAuthorization.legallyAuthorizedToWork}
                          onChange={(value) => setConfigField('workAuthorization', 'legallyAuthorizedToWork', value)}
                          options={['Yes', 'No']}
                        />
                        <SelectField
                          label="Needs sponsorship"
                          value={state.config.workAuthorization.requireSponsorship}
                          onChange={(value) => setConfigField('workAuthorization', 'requireSponsorship', value)}
                          options={['No', 'Yes']}
                        />
                        <Field label="Work permit type" value={state.config.workAuthorization.workPermitType} onChange={(value) => setConfigField('workAuthorization', 'workPermitType', value)} />
                        <Field label="Salary expectation" value={state.config.compensation.salaryExpectation} onChange={(value) => setConfigField('compensation', 'salaryExpectation', value)} />
                        <Field label="Salary currency" value={state.config.compensation.salaryCurrency} onChange={(value) => setConfigField('compensation', 'salaryCurrency', value)} />
                        <Field label="Salary range min" value={state.config.compensation.salaryRangeMin} onChange={(value) => setConfigField('compensation', 'salaryRangeMin', value)} />
                        <Field label="Salary range max" value={state.config.compensation.salaryRangeMax} onChange={(value) => setConfigField('compensation', 'salaryRangeMax', value)} />
                        <Field label="Years of experience" value={state.config.experience.yearsOfExperienceTotal} onChange={(value) => setConfigField('experience', 'yearsOfExperienceTotal', value)} />
                        <Field label="Education level" value={state.config.experience.educationLevel} onChange={(value) => setConfigField('experience', 'educationLevel', value)} />
                        <Field label="Current job title" value={state.config.experience.currentJobTitle} onChange={(value) => setConfigField('experience', 'currentJobTitle', value)} />
                        <Field label="Target role" value={state.config.experience.targetRole} onChange={(value) => setConfigField('experience', 'targetRole', value)} />
                        <Field label="Earliest start date" value={state.config.availability.earliestStartDate} onChange={(value) => setConfigField('availability', 'earliestStartDate', value)} />
                      </div>
                    </div>

                    <div className="section-block">
                      <h3>Skills and resume facts</h3>
                      <div className="text-grid">
                        <TextAreaField label="Programming languages" value={state.config.skillsBoundary.programmingLanguages} onChange={(value) => setConfigField('skillsBoundary', 'programmingLanguages', value)} />
                        <TextAreaField label="Frameworks and libraries" value={state.config.skillsBoundary.frameworks} onChange={(value) => setConfigField('skillsBoundary', 'frameworks', value)} />
                        <TextAreaField label="Tools and platforms" value={state.config.skillsBoundary.tools} onChange={(value) => setConfigField('skillsBoundary', 'tools', value)} />
                        <TextAreaField label="Companies to preserve" value={state.config.resumeFacts.preservedCompanies} onChange={(value) => setConfigField('resumeFacts', 'preservedCompanies', value)} />
                        <TextAreaField label="Projects to preserve" value={state.config.resumeFacts.preservedProjects} onChange={(value) => setConfigField('resumeFacts', 'preservedProjects', value)} />
                        <TextAreaField label="Real metrics to preserve" value={state.config.resumeFacts.realMetrics} onChange={(value) => setConfigField('resumeFacts', 'realMetrics', value)} />
                        <Field label="School to preserve" value={state.config.resumeFacts.preservedSchool} onChange={(value) => setConfigField('resumeFacts', 'preservedSchool', value)} />
                      </div>
                    </div>
                  </article>
                ) : null}

                {activeSetupStep === 'resume' ? (
                  <article className="panel-subsection panel-subsection-setup">
                    <div className="section-block">
                      <h3>Resume files</h3>
                      <div className="text-grid setup-upload-grid">
                        <UploadField
                          label="Resume plain text"
                          hint={state.config.resumeTextName || 'Required: upload a .txt or .md version for scoring and tailoring.'}
                          accept=".txt,text/plain,.md,text/markdown"
                          onChange={(file) => {
                            setResumeFiles((current) => ({ ...current, text: file }))
                            setTopLevelConfig('resumeTextName', file?.name ?? state.config.resumeTextName)
                          }}
                        />

                        <UploadField
                          label="Resume PDF"
                          hint={state.config.resumePdfName || 'Optional: upload the master PDF resume used for applications.'}
                          accept=".pdf,application/pdf"
                          onChange={(file) => {
                            setResumeFiles((current) => ({ ...current, pdf: file }))
                            setTopLevelConfig('resumePdfName', file?.name ?? state.config.resumePdfName)
                          }}
                        />
                      </div>
                      <p className="panel-note">
                        These files are stored in <code>~/.applypilot</code> so the real ApplyPilot CLI
                        and this launcher always share the same data.
                      </p>
                    </div>
                  </article>
                ) : null}

                {activeSetupStep === 'search' ? (
                  <article className="panel-subsection panel-subsection-setup">
                    <div className="section-block">
                      <h3>Search setup</h3>
                      <ToggleField
                        label="Remote only search"
                        checked={state.config.search.remoteOnly}
                        onChange={(checked) => setConfigField('search', 'remoteOnly', checked)}
                      />
                      {!state.config.search.remoteOnly ? (
                        <>
                          <Field label="Target city or region" value={state.config.search.location} onChange={(value) => setConfigField('search', 'location', value)} />
                          <Field label="Search radius in miles" value={state.config.search.distance} onChange={(value) => setConfigField('search', 'distance', value)} />
                        </>
                      ) : null}
                      <TextAreaField
                        label="Target job titles"
                        hint="One title per line or separated by commas"
                        value={state.config.search.queries}
                        onChange={(value) => setConfigField('search', 'queries', value)}
                      />
                      <Field label="Captcha solver key (optional)" type="password" value={state.config.ai.capsolverKey} onChange={(value) => setConfigField('ai', 'capsolverKey', value)} />
                      <p className="panel-note">
                        Codex is the default engine now. API tokens are no longer part of the normal setup path.
                      </p>
                    </div>
                  </article>
                ) : null}

                <div className="setup-footer">
                  <p className="panel-note">
                    Save once after updating any of these setup steps.
                  </p>
                  <button className="primary-action" type="button" onClick={saveSetup} disabled={state.saving}>
                    {state.saving ? 'Saving setup…' : 'Save setup files'}
                  </button>
                </div>
              </div>
            ) : null}
          </section>

          <article className="panel panel-wide">
            <div className="card-header">
              <div>
                <p className="kicker">Step 4</p>
                <h2>Run ApplyPilot</h2>
              </div>
            </div>

            <p className="panel-note action-intro">
              Most people only need these buttons. Extra tuning is under Advanced options.
            </p>
            <div className="action-lane">
              <button className="secondary-action" type="button" onClick={() => startTask('bootstrap')} disabled={state.actionRunning}>
                Install or repair ApplyPilot
              </button>
              <button className="primary-action" type="button" onClick={() => startTask('run', runOptions)} disabled={state.actionRunning || !readiness.pythonReady || !readiness.configFilesReady || !readiness.resumeTextReady}>
                Start job search
              </button>
              <button className="secondary-action" type="button" onClick={() => startTask('applyLive', applyOptions)} disabled={state.actionRunning || (stats?.ready_to_apply ?? 0) === 0}>
                Apply live
              </button>
            </div>

            <details className="details-panel">
              <summary>Advanced options</summary>

              <div className="details-body">
                <div className="support-actions">
                  <button className="ghost-action" type="button" onClick={() => startTask('applyDryRun', applyOptions)} disabled={state.actionRunning || (stats?.ready_to_apply ?? 0) === 0}>
                    Apply dry run
                  </button>
                  <button className="ghost-action" type="button" onClick={() => startTask('status')} disabled={state.actionRunning}>
                    Show status
                  </button>
                  <button className="ghost-action" type="button" onClick={() => startTask('dashboard')} disabled={state.actionRunning}>
                    Build dashboard
                  </button>
                </div>

                <div className="command-grid">
                  <div className="panel-subsection">
                    <h3>Job prep options</h3>
                    <Field label="Minimum fit score" value={runOptions.minScore} onChange={(value) => setRunOptions((current) => ({ ...current, minScore: value }))} />
                    <Field label="Workers" value={runOptions.workers} onChange={(value) => setRunOptions((current) => ({ ...current, workers: value }))} />
                  </div>

                  <div className="panel-subsection">
                    <h3>Apply options</h3>
                    <Field label="Minimum fit score" value={applyOptions.minScore} onChange={(value) => setApplyOptions((current) => ({ ...current, minScore: value }))} />
                    <Field label="Workers" value={applyOptions.workers} onChange={(value) => setApplyOptions((current) => ({ ...current, workers: value }))} />
                    <Field label="Application limit" value={applyOptions.limit} onChange={(value) => setApplyOptions((current) => ({ ...current, limit: value }))} />
                    <Field label="Specific job URL (optional)" value={applyOptions.targetUrl} onChange={(value) => setApplyOptions((current) => ({ ...current, targetUrl: value }))} />
                    <ToggleField label="Headless browser" checked={applyOptions.headless} onChange={(checked) => setApplyOptions((current) => ({ ...current, headless: checked }))} />
                  </div>
                </div>
              </div>
            </details>
          </article>

          <article className="panel panel-wide">
            <div className="card-header">
              <div>
                <p className="kicker">Live output</p>
                <h2>Task logs</h2>
              </div>
              {currentTask ? <span className={`task-status task-status-${currentTask.status}`}>{currentTask.status}</span> : null}
            </div>

            {currentTask ? (
              <>
                <div className="task-meta">
                  <span>{currentTask.label}</span>
                  <span>{formatTime(currentTask.startedAt)}</span>
                  {currentTask.endedAt ? <span>Ended {formatTime(currentTask.endedAt)}</span> : null}
                </div>
                <pre className="log-console">{currentTask.logs || 'Waiting for output…'}</pre>
              </>
            ) : (
              <p className="panel-note">No task has run yet. Save setup first, then follow the next-step button at the top.</p>
            )}
          </article>
        </section>
      </main>
    </div>
  )
}

function Field({ label, value, onChange, type = 'text' }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function SelectField({ label, value, onChange, options }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  )
}

function TextAreaField({ label, value, onChange, hint = '' }) {
  return (
    <label className="field field-textarea">
      <span>{label}</span>
      {hint ? <small>{hint}</small> : null}
      <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={4} />
    </label>
  )
}

function ToggleField({ label, checked, onChange }) {
  return (
    <label className="toggle-field">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

function UploadField({ label, hint, accept, onChange }) {
  return (
    <label className="upload-field">
      <span>{label}</span>
      <small>{hint}</small>
      <input type="file" accept={accept} onChange={(event) => onChange(event.target.files?.[0] ?? null)} />
    </label>
  )
}

function SetupStepTab({ step, title, active, onClick }) {
  return (
    <button
      className={`setup-step-tab ${active ? 'is-active' : ''}`}
      type="button"
      onClick={onClick}
    >
      <span>{step}</span>
      <strong>{title}</strong>
    </button>
  )
}

function StatusItem({ label, ready, optional = false }) {
  return (
    <li className={`status-item ${ready ? 'is-ready' : 'is-missing'} ${optional ? 'is-optional' : ''}`}>
      <span className="status-dot" />
      <span>{label}</span>
      {optional ? <small>Optional</small> : null}
    </li>
  )
}

function MetricCard({ label, value }) {
  return (
    <article className="metric-card">
      <p>{label}</p>
      <strong>{value}</strong>
    </article>
  )
}

async function readFileAsBase64(file) {
  const arrayBuffer = await file.arrayBuffer()
  const bytes = new Uint8Array(arrayBuffer)
  let binary = ''

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return window.btoa(binary)
}

function formatTime(value) {
  if (!value) {
    return ''
  }

  return new Date(value).toLocaleString()
}

function formatStepName(step) {
  if (step === 'setup') return 'Save setup'
  if (step === 'install') return 'Install'
  if (step === 'pipeline') return 'Prepare jobs'
  if (step === 'apply') return 'Apply'
  return step
}

function snapshotSetupConfig(config) {
  return JSON.stringify({
    personal: config.personal,
    workAuthorization: config.workAuthorization,
    compensation: config.compensation,
    experience: config.experience,
    skillsBoundary: config.skillsBoundary,
    resumeFacts: config.resumeFacts,
    availability: config.availability,
    resumePdfName: config.resumePdfName,
    resumeTextName: config.resumeTextName,
    search: config.search,
    ai: {
      capsolverKey: config.ai.capsolverKey,
    },
  })
}

function isProfileComplete(config) {
  const requiredValues = [
    config.personal.fullName,
    config.personal.email,
    config.personal.phone,
    config.personal.address,
    config.personal.city,
    config.personal.provinceState,
    config.personal.country,
    config.personal.postalCode,
    config.compensation.salaryExpectation,
    config.experience.yearsOfExperienceTotal,
    config.experience.currentJobTitle,
    config.experience.targetRole,
    config.availability.earliestStartDate,
  ]

  return requiredValues.every(hasText)
}

function isSearchComplete(config) {
  if (!hasText(config.search.queries)) {
    return false
  }

  if (config.search.remoteOnly) {
    return true
  }

  return hasText(config.search.location)
}

function buildSetupSummary(config) {
  const parts = [
    config.personal.fullName,
    config.experience.targetRole,
    config.search.remoteOnly ? 'Remote only' : formatSearchLocation(config.search.location),
  ].filter(Boolean)

  return parts.join(' - ') || 'Saved setup details will show here.'
}

function formatSearchLocation(location) {
  return String(location ?? '').trim()
}

function hasText(value) {
  return String(value ?? '').trim().length > 0
}

export default App
