// seilnav-tweaks.jsx — SeilNav Tweaks panel
const { useTweaks, TweaksPanel, TweakSection, TweakSlider, TweakRadio, TweakSelect, TweakColor } = window;

const TWEAK_DEFAULTS = {
  "theme": "dag",
  "grayscale": 0,
  "sepia": 0,
  "brightness": 1,
  "contrast": 1,
  "hue": 0,
  "saturate": 1,
  "invert": 0,
  "accent": "#2fe0c0",
  "labelFont": "saira",
  "touch": 46,
  "vectorMin": 8,
  "cpaLimit": 0.35,
  "alarmMin": 2
};

const PRESETS = {
  dag:     { grayscale: 0, sepia: 0,    brightness: 1,    contrast: 1,    hue: 0,   saturate: 1,   invert: 0 },
  gratone: { grayscale: 1, sepia: 0,    brightness: 1,    contrast: 1,    hue: 0,   saturate: 1,   invert: 0 },
  sepia:   { grayscale: 0, sepia: 0.45, brightness: 0.97, contrast: 1.02, hue: 0,   saturate: 1.1, invert: 0 },
  natt:    { grayscale: 0, sepia: 0,    brightness: 0.8,  contrast: 1.08, hue: 180, saturate: 0.9, invert: 1 },
};

// Merge saved filter from localStorage
let savedDefaults = Object.assign({}, TWEAK_DEFAULTS);
try {
  const saved = JSON.parse(localStorage.getItem('seilnav.filter') || 'null');
  if (saved) savedDefaults = Object.assign(savedDefaults, saved);
} catch(e) {}

function App() {
  const [t, setTweak] = useTweaks(savedDefaults);

  React.useEffect(() => { window.SeilNav && window.SeilNav.applyTweaks(t); }, [t]);

  const setTheme = (key) => setTweak(Object.assign({ theme: key }, PRESETS[key] || {}));
  const setParam = (k) => (v) => setTweak({ [k]: v, theme: 'custom' });

  const themeOpts = [
    { value: 'dag', label: 'Dag' }, { value: 'gratone', label: 'Gråtone' },
    { value: 'sepia', label: 'Sepia' }, { value: 'natt', label: 'Natt' },
    { value: 'custom', label: 'Egendefinert' },
  ];

  return (
    <TweaksPanel title="SeilNav · Tweaks">
      <TweakSection label="Kartstil" />
      <TweakSelect label="Forhåndsinnstilling" value={t.theme} options={themeOpts} onChange={setTheme} />

      <TweakSection label="Kartfilter" />
      <TweakSlider label="Gråtone"       value={t.grayscale}  min={0}   max={1}   step={0.05} onChange={setParam('grayscale')} />
      <TweakSlider label="Sepia"         value={t.sepia}      min={0}   max={1}   step={0.05} onChange={setParam('sepia')} />
      <TweakSlider label="Lysstyrke"     value={t.brightness} min={0.4} max={1.6} step={0.05} unit="×" onChange={setParam('brightness')} />
      <TweakSlider label="Kontrast"      value={t.contrast}   min={0.5} max={2}   step={0.05} unit="×" onChange={setParam('contrast')} />
      <TweakSlider label="Fargerotasjon" value={t.hue}        min={0}   max={360} step={5}    unit="°" onChange={setParam('hue')} />
      <TweakSlider label="Metning"       value={t.saturate}   min={0}   max={3}   step={0.1}  unit="×" onChange={setParam('saturate')} />
      <TweakSlider label="Inverter"      value={t.invert}     min={0}   max={1}   step={0.05} onChange={setParam('invert')} />

      <TweakSection label="Utseende" />
      <TweakColor label="Aksentfarge" value={t.accent}
                  options={['#2fe0c0', '#3aa0ff', '#ffb028', '#46d18b']}
                  onChange={(v) => setTweak('accent', v)} />
      <TweakRadio label="Etikett-font" value={t.labelFont}
                  options={[{ value: 'saira', label: 'Saira' }, { value: 'mono', label: 'Mono' }]}
                  onChange={(v) => setTweak('labelFont', v)} />
      <TweakSlider label="Trykkflate" value={t.touch} min={40} max={60} step={1} unit="px"
                   onChange={(v) => setTweak('touch', v)} />

      <TweakSection label="Kollisjon (CPA)" />
      <TweakSlider label="Varsle før kollisjon" value={t.alarmMin}  min={1}    max={10} step={1}    unit=" min" onChange={(v) => setTweak('alarmMin', v)} />
      <TweakSlider label="CPA-varselgrense"     value={t.cpaLimit}  min={0.05} max={1}  step={0.05} unit=" nm"  onChange={(v) => setTweak('cpaLimit', v)} />
    </TweaksPanel>
  );
}

ReactDOM.createRoot(document.getElementById('tweaks-root')).render(<App />);
