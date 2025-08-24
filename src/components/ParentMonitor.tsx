import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ArrowLeft, Users, Wifi, Play, Volume2, VolumeX, Maximize2 } from 'lucide-react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

interface Device {
  id: string;
  name: string;
  status: 'online' | 'offline';
  timestamp?: number;
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);

  // Discover baby monitor devices on local network
  useEffect(() => {
    const setupDeviceDiscovery = () => {
      // Create broadcast channel for device discovery
      broadcastChannelRef.current = new BroadcastChannel('baby-monitor-discovery');
      
      const discoveredDevices = new Map<string, Device>();
      
      // Listen for device announcements
      broadcastChannelRef.current.onmessage = (event) => {
        const { type, device, answer, parentId } = event.data;
        
        if (type === 'device-announcement' && device?.type === 'baby-monitor') {
          // Check if device is recent (within last 30 seconds)
          const thirtySecondsAgo = Date.now() - (30 * 1000);
          const isOnline = device.timestamp > thirtySecondsAgo;
          
          discoveredDevices.set(device.id, {
            id: device.id,
            name: device.name,
            status: isOnline ? 'online' : 'offline',
            timestamp: device.timestamp
          });
          
          // Update devices list
          setAvailableDevices(Array.from(discoveredDevices.values()));
        } else if (type === 'connection-answer' && parentId && answer) {
          handleConnectionAnswer(answer);
        }
      };
      
      // Request device announcements
      broadcastChannelRef.current.postMessage({ type: 'discovery-request' });
      
      // Clean up old devices periodically
      const cleanupInterval = setInterval(() => {
        const now = Date.now();
        const oneMinuteAgo = now - (60 * 1000);
        
        discoveredDevices.forEach((device, id) => {
          // Remove devices not seen in the last minute
          if (!device.timestamp || device.timestamp < oneMinuteAgo) {
            discoveredDevices.delete(id);
          }
        });
        
        setAvailableDevices(Array.from(discoveredDevices.values()));
      }, 10000);
      
      return () => {
        clearInterval(cleanupInterval);
        if (broadcastChannelRef.current) {
          broadcastChannelRef.current.close();
        }
      };
    };

    const cleanup = setupDeviceDiscovery();
    return cleanup;
  }, []);

  const connectToDevice = async (device: Device) => {
    try {
      await Haptics.impact({ style: ImpactStyle.Medium });
    } catch (error) {
      console.log('Haptics not available:', error);
    }

    setIsConnecting(true);
    setSelectedDevice(device);

    try {
      // Create WebRTC peer connection
      const peerConnection = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });
      
      peerConnectionRef.current = peerConnection;
      
      // Handle incoming stream
      peerConnection.ontrack = (event) => {
        if (videoRef.current && event.streams[0]) {
          videoRef.current.srcObject = event.streams[0];
        }
      };
      
      // Create offer
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      
      // Send connection request via broadcast channel
      if (broadcastChannelRef.current) {
        const parentId = `parent-${Date.now()}`;
        broadcastChannelRef.current.postMessage({
          type: 'connection-request',
          parentId,
          offer,
          deviceId: device.id
        });
      }
      
      // Wait for connection establishment
      setTimeout(() => {
        if (peerConnection.connectionState === 'connected' || 
            peerConnection.connectionState === 'connecting') {
          setIsConnecting(false);
          setIsConnected(true);
        } else {
          setIsConnecting(false);
          alert('Failed to connect to baby monitor. Please try again.');
        }
      }, 5000);
      
    } catch (error) {
      console.error('Connection error:', error);
      setIsConnecting(false);
      alert('Failed to establish connection. Please check network and try again.');
    }
  };

  const handleConnectionAnswer = async (answer: RTCSessionDescriptionInit) => {
    if (peerConnectionRef.current) {
      try {
        await peerConnectionRef.current.setRemoteDescription(answer);
        setIsConnecting(false);
        setIsConnected(true);
      } catch (error) {
        console.error('Error handling connection answer:', error);
      }
    }
  };

  const disconnect = async () => {
    try {
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch (error) {
      console.log('Haptics not available:', error);
    }

    // Close peer connection
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    
    // Notify baby monitor of disconnection
    if (broadcastChannelRef.current && selectedDevice) {
      broadcastChannelRef.current.postMessage({
        type: 'parent-disconnected',
        parentId: `parent-${Date.now()}`,
        deviceId: selectedDevice.id
      });
    }
    
    // Clear video
    if (videoRef.current) {
      videoRef.current.srcObject = null;
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
            className="flex items-center gap-2 min-h-12 px-4"
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
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={isMuted}
            className="w-full h-full object-cover"
          />
          
          {/* Loading overlay when no stream */}
          {!videoRef.current?.srcObject && (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground bg-muted">
              <div className="text-center">
                <Play className="w-16 h-16 mx-auto mb-4" />
                <p className="text-lg">Live Video Stream</p>
                <p className="text-sm">Connecting to baby monitor...</p>
              </div>
            </div>
          )}

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
          className="flex items-center gap-2 min-h-12 px-4"
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