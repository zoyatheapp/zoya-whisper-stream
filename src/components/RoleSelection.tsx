import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Baby, Users, Heart } from 'lucide-react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import zoyaLogo from '@/assets/zoya-logo.jpg';

interface RoleSelectionProps {
  onRoleSelect: (role: 'parent' | 'baby') => void;
}

const RoleSelection = ({ onRoleSelect }: RoleSelectionProps) => {
  const [selectedRole, setSelectedRole] = useState<'parent' | 'baby' | null>(null);

  const handleRoleSelect = async (role: 'parent' | 'baby') => {
    // Haptic feedback for mobile
    try {
      await Haptics.impact({ style: ImpactStyle.Medium });
    } catch (error) {
      console.log('Haptics not available:', error);
    }

    setSelectedRole(role);
    
    // Smooth transition delay
    setTimeout(() => {
      onRoleSelect(role);
    }, 300);
  };

  return (
    <div className="min-h-screen hero-gradient flex flex-col items-center justify-center p-6">
      {/* Logo Section */}
      <div className="text-center mb-12 animate-fade-in">
        <div className="w-24 h-24 mx-auto mb-6 rounded-full overflow-hidden shadow-large float-animation">
          <img 
            src={zoyaLogo} 
            alt="Zoya Baby Monitor" 
            className="w-full h-full object-cover"
          />
        </div>
        <h1 className="text-4xl font-bold text-primary-foreground mb-2">
          Zoya
        </h1>
        <p className="text-lg text-primary-foreground/80 flex items-center justify-center gap-2">
          <Heart className="w-5 h-5" />
          Baby Monitor
        </p>
      </div>

      {/* Role Selection Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-md">
        <Card 
          className={`p-8 cursor-pointer smooth-transition hover:scale-105 hover:shadow-large ${
            selectedRole === 'baby' ? 'ring-4 ring-primary scale-105' : ''
          }`}
          onClick={() => handleRoleSelect('baby')}
        >
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 bg-secondary rounded-full flex items-center justify-center">
              <Baby className="w-8 h-8 text-secondary-foreground" />
            </div>
            <h3 className="text-xl font-semibold mb-2 text-card-foreground">Baby</h3>
            <p className="text-sm text-muted-foreground">
              Turn this device into a baby monitor
            </p>
          </div>
        </Card>

        <Card 
          className={`p-8 cursor-pointer smooth-transition hover:scale-105 hover:shadow-large ${
            selectedRole === 'parent' ? 'ring-4 ring-primary scale-105' : ''
          }`}
          onClick={() => handleRoleSelect('parent')}
        >
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 bg-accent rounded-full flex items-center justify-center">
              <Users className="w-8 h-8 text-accent-foreground" />
            </div>
            <h3 className="text-xl font-semibold mb-2 text-card-foreground">Parent</h3>
            <p className="text-sm text-muted-foreground">
              Connect to watch over your baby
            </p>
          </div>
        </Card>
      </div>

      <div className="mt-8 text-center">
        <p className="text-sm text-primary-foreground/60">
          Select your role to get started
        </p>
      </div>
    </div>
  );
};

export default RoleSelection;