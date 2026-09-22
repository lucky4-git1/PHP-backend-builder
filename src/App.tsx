import { useEffect, useState } from 'react';
import { usePipeline, STEPS, canProceed } from '@/store/pipelineStore';
import { emptyProject, templateBlog, templateEcommerce, templateSaas } from '@/lib/builder';
import { Stepper, SidebarStepper } from '@/components/pipeline/Stepper';
import { StepCreate, StepImport, StepAnalyze, StepFindings } from '@/components/pipeline/stepsA';
import { StepRequirements, StepDatabase, StepApi } from '@/components/pipeline/stepsB';
import { StepGenerate, StepIntegration, StepApply } from '@/components/pipeline/stepsC';
import { StepTests, StepSecurity, StepArchitecture, StepExport } from '@/components/pipeline/stepsD';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { Database, Moon, Sun, RotateCcw, ArrowLeft, ArrowRight, Sparkles, ShieldCheck, Zap, Menu, X } from 'lucide-react';
import { toast } from '@/components/ui/toaster';

export default function App() {
  const p = usePipeline();
  const [dark, setDark] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);

  useEffect(() => {
    if (p.step === 6 && !p.builder) {
      p.setBuilder(emptyProject(p.projectName));
    }
  }, [p.step]);

  function toggleDark() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
  }

  function loadTemplate(name: 'blank' | 'blog' | 'shop' | 'saas') {
    const cur = p.projectName;
    const next =
      name === 'blog' ? templateBlog()
      : name === 'shop' ? templateEcommerce()
      : name === 'saas' ? templateSaas()
      : emptyProject(cur);
    if (name === 'blank') next.config.projectName = cur;
    p.setBuilder(next);
    p.setSource('manual');
    p.goto(6);
    toast({ title: 'Template loaded', description: `${name} → database designer`, variant: 'success' });
  }

  const gate = canProceed(p.step, p);
  const stepMeta = STEPS.find((s) => s.n === p.step);
  const progressPct = Math.round((p.step / 14) * 100);

  return (
    <div className="min-h-screen bg-[#fcfcfd] dark:bg-zinc-950 text-foreground">
      {/* Top bar — IDE style */}
      <header className="sticky top-0 z-40 border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl">
        <div className="mx-auto max-w-[1600px] px-4 lg:px-6 py-3 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-lg shadow-violet-500/20 shrink-0">
            <Database className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <input
                value={p.projectName}
                onChange={(e) => p.setProjectName(e.target.value)}
                className="bg-transparent font-bold text-[15px] tracking-tight outline-none border-b border-transparent hover:border-zinc-300 focus:border-violet-500 px-1 w-44 lg:w-56"
                aria-label="Project name"
              />
              <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-violet-50 dark:bg-violet-950/50 border border-violet-200 dark:border-violet-800 px-2.5 py-0.5 text-[11px] font-semibold text-violet-700 dark:text-violet-300">
                <Sparkles className="h-3 w-3" /> FRONTEND → IR → GENERATE → VALIDATE → EXPORT
              </span>
              <Badge variant="neutral" className="hidden md:inline-flex">Step {p.step}/14</Badge>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <div className="h-1.5 flex-1 max-w-[280px] rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden hidden sm:flex">
                <div className="h-full bg-gradient-to-r from-violet-600 to-indigo-600 transition-all duration-500" style={{ width: `${progressPct}%` }} />
              </div>
              <span className="text-[11px] text-muted-foreground hidden sm:inline">{progressPct}% · {stepMeta?.label}</span>
              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 sm:hidden">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Step {p.step}
              </span>
            </div>
          </div>
          {/* Actions */}
          <div className="hidden lg:flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-full border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-1 py-1">
              <span className="text-[11px] font-medium text-muted-foreground px-2 hidden xl:inline">Template</span>
              <Select
                value=""
                onChange={(e) => { const v = e.target.value; if (v) loadTemplate(v as 'blank' | 'blog' | 'shop' | 'saas'); }}
                options={[
                  { value: '', label: 'Choose…' },
                  { value: 'blog', label: 'Blog API' },
                  { value: 'shop', label: 'E-commerce' },
                  { value: 'saas', label: 'SaaS starter' },
                  { value: 'blank', label: 'Blank' },
                ]}
              />
            </div>
            <Button variant="outline" size="sm" onClick={toggleDark} aria-label="Toggle theme" className="rounded-full">
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Button variant="outline" size="sm" onClick={() => { p.reset(); toast({ title: 'Workspace reset', variant: 'success' }); }} className="rounded-full">
              <RotateCcw className="h-4 w-4 mr-1.5" /> Reset
            </Button>
          </div>
          <button className="lg:hidden p-2 rounded-lg hover:bg-accent" onClick={() => setMobileNav(!mobileNav)} aria-label="Menu">
            {mobileNav ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
        <div className="mx-auto max-w-[1600px] px-4 lg:px-6 pb-3">
          <Stepper step={p.step} done={p.done} onGoto={(n) => p.goto(n)} />
        </div>
        {mobileNav && (
          <div className="lg:hidden border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" size="sm" onClick={toggleDark}>{dark ? 'Light' : 'Dark'} mode</Button>
              <Button variant="outline" size="sm" onClick={() => { p.reset(); setMobileNav(false); }}>Reset</Button>
            </div>
            <SidebarStepper step={p.step} done={p.done} onGoto={(n) => { p.goto(n); setMobileNav(false); }} />
          </div>
        )}
      </header>

      <div className="mx-auto max-w-[1600px] px-4 lg:px-6 py-6 flex gap-6">
        {/* Sidebar — desktop */}
        <aside className="hidden xl:block w-[220px] shrink-0">
          <div className="sticky top-[112px] space-y-4">
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3">
              <p className="text-[11px] font-semibold tracking-widest text-muted-foreground mb-2">WORKSPACE</p>
              <SidebarStepper step={p.step} done={p.done} onGoto={(n) => p.goto(n)} />
            </div>
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-gradient-to-br from-violet-600 to-indigo-600 text-white p-4">
              <div className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4" /> Production-grade</div>
              <p className="text-xs text-violet-100 mt-1 leading-relaxed">Every artifact is validated. No fake CRUD, no blind trust in generated code.</p>
              <div className="mt-3 flex items-center gap-1.5 text-[11px] bg-white/15 rounded-full px-2.5 py-1 w-fit">
                <Zap className="h-3 w-3" /> IR + AST + Validation
              </div>
            </div>
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3">
              <p className="text-xs font-medium">Project</p>
              <p className="text-xs text-muted-foreground truncate">{p.projectName}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                <Badge variant={p.frontendFiles.length ? 'success' : 'neutral'}>{p.frontendFiles.length} files</Badge>
                <Badge variant={p.generated.length ? 'success' : 'neutral'}>{p.generated.length} generated</Badge>
              </div>
            </div>
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 min-w-0 space-y-4">
          {p.step === 1 && <StepCreate />}
          {p.step === 2 && <StepImport />}
          {p.step === 3 && <StepAnalyze />}
          {p.step === 4 && <StepFindings />}
          {p.step === 5 && <StepRequirements />}
          {p.step === 6 && <StepDatabase />}
          {p.step === 7 && <StepApi />}
          {p.step === 8 && <StepGenerate />}
          {p.step === 9 && <StepIntegration />}
          {p.step === 10 && <StepApply />}
          {p.step === 11 && <StepTests />}
          {p.step === 12 && <StepSecurity />}
          {p.step === 13 && <StepArchitecture />}
          {p.step === 14 && <StepExport />}

          <div className="flex items-center gap-2 pt-2 flex-wrap">
            <Button variant="outline" disabled={p.step <= 1} onClick={() => p.back()} className="rounded-full">
              <ArrowLeft className="h-4 w-4 mr-1.5" /> Back
            </Button>
            {p.step < 14 && (
              <Button
                disabled={!gate.ok}
                title={gate.ok ? `Go to ${p.step + 1}` : gate.reason}
                onClick={() => {
                  if (!gate.ok) { toast({ title: 'Blocked', description: gate.reason ?? 'Complete this step.', variant: 'error' }); return; }
                  p.next();
                }}
                className="rounded-full shadow-sm"
              >
                Continue <ArrowRight className="h-4 w-4 ml-1.5" />
              </Button>
            )}
            {!gate.ok ? (
              <span className="text-xs px-3 py-1.5 rounded-full bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300">{gate.reason}</span>
            ) : (
              p.step < 14 && <span className="text-xs text-muted-foreground">→ {STEPS.find((s) => s.n === p.step + 1)?.label}</span>
            )}
          </div>
        </main>
      </div>

      <footer className="border-t border-zinc-200 dark:border-zinc-800 py-4 text-center text-[11px] tracking-wide text-muted-foreground">
        PHP Backend Builder · <span className="font-medium">IR</span> · <span className="font-medium">AST</span> · Validation pipeline · Auto-repair · No data leaves your browser
      </footer>
    </div>
  );
}
