import { AppShell } from './components/AppShell';
import { HealthView } from './views/HealthView';

export function App(): JSX.Element {
  return (
    <AppShell>
      <HealthView />
    </AppShell>
  );
}
