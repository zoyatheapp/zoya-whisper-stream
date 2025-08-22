import { useState } from 'react';
import RoleSelection from '@/components/RoleSelection';
import BabyMonitor from '@/components/BabyMonitor';
import ParentMonitor from '@/components/ParentMonitor';

type AppMode = 'role-selection' | 'baby' | 'parent';

const Index = () => {
  const [currentMode, setCurrentMode] = useState<AppMode>('role-selection');

  const handleRoleSelect = (role: 'parent' | 'baby') => {
    setCurrentMode(role);
  };

  const handleBack = () => {
    setCurrentMode('role-selection');
  };

  switch (currentMode) {
    case 'baby':
      return <BabyMonitor onBack={handleBack} />;
    case 'parent':
      return <ParentMonitor onBack={handleBack} />;
    default:
      return <RoleSelection onRoleSelect={handleRoleSelect} />;
  }
};

export default Index;