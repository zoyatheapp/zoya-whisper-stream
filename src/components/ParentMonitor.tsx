import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ArrowLeft, Users, Wifi, Play, Volume2, VolumeX, Maximize2 } from 'lucide-react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

interface Device {
  id: string;
  name: string;
  status: 'online' | 'offline';
}

interface ParentMonitorProps {
  onBack: () => void;
}

const ParentMonitor = ({ onBack }: ParentMonitorProps) => {
  const [availableDevices, setAvailableDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  // Discover real baby monitor devices
  useEffect(() => {
    const discoverDevices = () => {
      const foundDevices: Device[] = [];
      
      // Check local storage for active baby monitors on same device
      const isLocalBabyActive = localStorage.getItem('babyMonitorActive');
      if (isLocalBabyActive) {
        const deviceId = localStorage.getItem('babyMonitorId');
        const deviceName = localStorage.getItem('babyMonitorName') || 'Baby Monitor';
        if (deviceId) {
          foundDevices.push({
            id: deviceId,
            name: deviceName,
            status: 'online'
          });
        }
      }
      
      // In a real app, you would scan the network here
      // For now, we'll simulate network discovery
      const networkDevices: Device[] = [
        { id: 'network-1', name: 'Nursery Camera', status: 'online' },
        { id: 'network-2', name: 'Sleep Room Monitor', status: 'offline' }
      ];
      
      // Only add network devices if no local device is found
      if (foundDevices.length === 0) {
        foundDevices.push(...networkDevices);
      }
      
      setAvailableDevices(foundDevices);
    };

    discoverDevices();
    
    // Refresh device list every 5 seconds
    const interval = setInterval(discoverDevices, 5000);
    
    return () => clearInterval(interval);
  }, []);

  const connectToDevice = async (device: Device) => {
    try {
      await Haptics.impact({ style: ImpactStyle.Medium });
    } catch (error) {
      console.log('Haptics not available:', error);
    }

    setIsConnecting(true);
    setSelectedDevice(device);

    // Simulate connection process
    setTimeout(() => {
      setIsConnecting(false);
      setIsConnected(true);
    }, 2000);
  };

  const disconnect = async () => {
    try {
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch (error) {
      console.log('Haptics not available:', error);
    }

    setIsConnected(false);
    setSelectedDevice(null);
  };

  const toggleMute = async () => {
    try {
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch (error) {
      console.log('Haptics not available:', error);
    }

    setIsMuted(!isMuted);
  };

  if (isConnected && selectedDevice) {
    return (
      <div className="min-h-screen bg-background pt-safe-area-top">
        {/* Header */}
        <div className="flex items-center justify-between p-4 pt-4 border-b">
          <Button 
            variant="ghost" 
            onClick={disconnect}
            className="flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Disconnect
          </Button>
          
          <div className="text-center">
            <p className="font-medium text-foreground">{selectedDevice.name}</p>
            <p className="text-sm text-success">Connected</p>
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={toggleMute}
          >
            {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
          </Button>
        </div>

        {/* Video Stream */}
        <div className="relative h-[calc(100vh-140px)] bg-muted flex items-center justify-center">
          <div className="text-center text-muted-foreground">
            <Play className="w-16 h-16 mx-auto mb-4" />
            <p className="text-lg">Live Video Stream</p>
            <p className="text-sm">Baby monitor feed would appear here</p>
          </div>

          {/* Fullscreen Button */}
          <Button
            variant="secondary"
            size="icon"
            className="absolute top-4 right-4 rounded-full"
          >
            <Maximize2 className="w-5 h-5" />
          </Button>
        </div>

        {/* Controls */}
        <div className="p-4 border-t">
          <div className="flex justify-center">
            <div className="flex items-center gap-4">
              <div className="w-2 h-2 bg-success rounded-full animate-pulse" />
              <span className="text-sm text-muted-foreground">Live</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 pt-safe-area-top">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 pt-4">
        <Button 
          variant="ghost" 
          onClick={onBack}
          className="flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
        
        <div className="flex items-center gap-2">
          <Wifi className="w-5 h-5 text-primary" />
          <span className="text-sm text-muted-foreground">Scanning...</span>
        </div>
      </div>

      <div className="max-w-md mx-auto">
        <Card className="p-6 text-center mb-6">
          <div className="w-20 h-20 mx-auto mb-4 bg-accent rounded-full flex items-center justify-center">
            <Users className="w-10 h-10 text-accent-foreground" />
          </div>
          <h2 className="text-2xl font-bold mb-2 text-card-foreground">Parent Monitor</h2>
          <p className="text-muted-foreground">
            Connect to available baby monitors
          </p>
        </Card>

        {/* Connecting State */}
        {isConnecting && (
          <Card className="p-6 text-center mb-6">
            <div className="flex justify-center mb-4">
              <div className="flex gap-1">
                <div className="connecting-dot"></div>
                <div className="connecting-dot"></div>
                <div className="connecting-dot"></div>
              </div>
            </div>
            <p className="font-medium text-card-foreground">Connecting...</p>
            <p className="text-sm text-muted-foreground">
              Establishing secure connection to {selectedDevice?.name}
            </p>
          </Card>
        )}

        {/* Available Devices */}
        <div className="space-y-3">
          <h3 className="font-medium text-foreground mb-3">Available Devices</h3>
          
          {availableDevices.length === 0 ? (
            <Card className="p-6 text-center">
              <div className="text-muted-foreground">
                <Wifi className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>No devices found</p>
                <p className="text-sm mt-1">Make sure baby monitor is online</p>
              </div>
            </Card>
          ) : (
            availableDevices.map((device) => (
              <Card 
                key={device.id}
                className={`p-4 cursor-pointer smooth-transition hover:shadow-medium ${
                  device.status === 'offline' ? 'opacity-50' : 'hover:scale-105'
                }`}
                onClick={() => device.status === 'online' && !isConnecting && connectToDevice(device)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${
                      device.status === 'online' ? 'bg-success animate-pulse' : 'bg-muted-foreground'
                    }`} />
                    <div>
                      <p className="font-medium text-card-foreground">{device.name}</p>
                      <p className="text-sm text-muted-foreground capitalize">{device.status}</p>
                    </div>
                  </div>
                  
                  {device.status === 'online' && (
                    <Button size="sm" variant="secondary">
                      Connect
                    </Button>
                  )}
                </div>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default ParentMonitor;