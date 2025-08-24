import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Camera, ArrowLeft, Wifi, WifiOff, Loader2, Volume2, VolumeX } from 'lucide-react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Capacitor } from '@capacitor/core';
import { Network } from '@capacitor/network';

interface Device {
  id: string;
  name: string;
  platform?: string;
  type: string;
  status: 'active' | 'inactive';
  timestamp: number;
  lastSeen: number;
}

interface ParentMonitorProps {
  onBack: () => void;
}

const ParentMonitor = ({ onBack }: ParentMonitorProps) => {
  const [availableDevices, setAvailableDevices] = useState<Device[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [isScanning, setIsScanning] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const discoveryIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);

  const stopScanning = () => {
    console.log('Stopping device scanning...');
    
    if (discoveryIntervalRef.current) {
      clearInterval(discoveryIntervalRef.current);
      discoveryIntervalRef.current = null;
    }
    
    if (channelRef.current) {
      channelRef.current.close();
      channelRef.current = null;
    }
    
    setIsScanning(false);
    setAvailableDevices([]);
  };

  const scanForDevices = async () => {
    try {
      console.log('Scanning for baby monitors on local network...');
      
      const networkStatus = await Network.getStatus();
      console.log('Network status:', networkStatus);
      
      // Create broadcast channel for real-time communication
      if (!channelRef.current) {
        channelRef.current = new BroadcastChannel('zoya-baby-monitor');
        
        // Listen for device announcements and connection answers
        channelRef.current.onmessage = (event) => {
          const { type, device, parentId, answer } = event.data;
          console.log('Received broadcast message:', event.data);
          
          if (type === 'device-announcement' && device?.type === 'baby-monitor') {
            console.log('Found baby monitor via broadcast:', device);
            // Check if device is recent (within last 15 seconds)
            const deviceAge = Date.now() - device.timestamp;
            if (deviceAge < 15000) {
              setAvailableDevices(prev => {
                const existing = prev.find(d => d.id === device.id);
                if (existing) {
                  // Update existing device
                  return prev.map(d => d.id === device.id ? { ...device, lastSeen: Date.now() } : d);
                } else {
                  // Add new device
                  return [...prev, { ...device, lastSeen: Date.now() }];
                }
              });
            }
          } else if (type === 'connection-answer') {
            console.log('Received connection answer from baby monitor');
            handleConnectionAnswer(answer);
          }
        };
      }
      
      // Scan localStorage and sessionStorage for baby monitor announcements
      const checkStoredDevices = () => {
        console.log('Checking stored devices...');
        
        const checkStorage = (storage: Storage, storageName: string) => {
          try {
            for (let i = 0; i < storage.length; i++) {
              const key = storage.key(i);
              if (key?.startsWith('baby-monitor-')) {
                const deviceData = JSON.parse(storage.getItem(key) || '{}');
                const deviceAge = Date.now() - deviceData.timestamp;
                
                // Only show devices announced within the last 15 seconds
                if (deviceAge < 15000 && deviceData.type === 'baby-monitor' && deviceData.status === 'active') {
                  console.log(`Found baby monitor in ${storageName}:`, deviceData);
                  setAvailableDevices(prev => {
                    const existing = prev.find(d => d.id === deviceData.id);
                    if (!existing) {
                      return [...prev, { ...deviceData, lastSeen: Date.now() }];
                    } else {
                      // Update timestamp
                      return prev.map(d => d.id === deviceData.id ? { ...deviceData, lastSeen: Date.now() } : d);
                    }
                  });
                }
              }
            }
          } catch (error) {
            console.error(`Error checking ${storageName}:`, error);
          }
        };
        
        checkStorage(localStorage, 'localStorage');
        checkStorage(sessionStorage, 'sessionStorage');
      };
      
      // Check immediately
      checkStoredDevices();
      
      // Continue checking every 2 seconds and clean up old devices
      const scanInterval = setInterval(() => {
        checkStoredDevices();
        
        // Remove devices not seen for more than 20 seconds
        setAvailableDevices(prev => 
          prev.filter(device => {
            const lastSeen = device.lastSeen || device.timestamp;
            return Date.now() - lastSeen < 20000;
          })
        );
      }, 2000);
      
      discoveryIntervalRef.current = scanInterval;
      setIsScanning(true);
      
      console.log('Parent monitor scanning started');
      
    } catch (error) {
      console.error('Error scanning for devices:', error);
      setIsScanning(false);
    }
  };

  const connectToDevice = async (device: Device) => {
    try {
      await Haptics.impact({ style: ImpactStyle.Medium });
    } catch (error) {
      console.log('Haptics not available:', error);
    }

    try {
      console.log('Attempting to connect to baby monitor:', device);
      setConnectionStatus('connecting');
      setConnectedDevice(device);

      // Create WebRTC peer connection
      const peerConnection = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      });

      peerConnectionRef.current = peerConnection;

      // Handle remote stream
      peerConnection.ontrack = (event) => {
        console.log('Received remote track:', event.track.kind);
        const [remoteStream] = event.streams;
        
        if (event.track.kind === 'video' && videoRef.current) {
          console.log('Setting video stream');
          videoRef.current.srcObject = remoteStream;
          videoRef.current.play().catch(console.error);
        } else if (event.track.kind === 'audio' && audioRef.current) {
          console.log('Setting audio stream');
          audioRef.current.srcObject = remoteStream;
          audioRef.current.play().catch(console.error);
        }
      };

      // Create offer
      const offer = await peerConnection.createOffer({
        offerToReceiveVideo: true,
        offerToReceiveAudio: true
      });
      
      await peerConnection.setLocalDescription(offer);
      console.log('Created offer, sending connection request...');

      // Send connection request via multiple channels
      if (channelRef.current) {
        channelRef.current.postMessage({
          type: 'connection-request',
          parentId: `parent-${Date.now()}`,
          offer
        });
      }

      // Also store the request in localStorage for the baby monitor to pick up
      const requestKey = `parent-request-${device.id}`;
      localStorage.setItem(requestKey, JSON.stringify({
        type: 'connection-request',
        parentId: `parent-${Date.now()}`,
        offer,
        timestamp: Date.now()
      }));

      // Monitor connection state
      peerConnection.onconnectionstatechange = () => {
        console.log('Connection state:', peerConnection.connectionState);
        
        if (peerConnection.connectionState === 'connected') {
          setConnectionStatus('connected');
          console.log('Successfully connected to baby monitor!');
        } else if (peerConnection.connectionState === 'disconnected' || 
                   peerConnection.connectionState === 'failed') {
          setConnectionStatus('disconnected');
          setConnectedDevice(null);
          console.log('Connection failed or disconnected');
        }
      };

      // Set up answer listener
      const checkForAnswer = setInterval(() => {
        const answerKey = `baby-answer-parent-${Date.now()}`;
        const storedAnswer = localStorage.getItem(answerKey);
        
        if (storedAnswer) {
          try {
            const answerData = JSON.parse(storedAnswer);
            if (answerData.type === 'connection-answer') {
              console.log('Found stored answer from baby monitor');
              handleConnectionAnswer(answerData.answer);
              localStorage.removeItem(answerKey);
              clearInterval(checkForAnswer);
            }
          } catch (error) {
            console.error('Error parsing stored answer:', error);
          }
        }
      }, 1000);

      // Timeout after 15 seconds if no connection
      setTimeout(() => {
        clearInterval(checkForAnswer);
        if (peerConnection.connectionState !== 'connected') {
          console.log('Connection timeout');
          peerConnection.close();
          setConnectionStatus('disconnected');
          setConnectedDevice(null);
          alert('Failed to connect to baby monitor. Please make sure both devices are on the same network and the baby monitor is active.');
        }
      }, 15000);

    } catch (error) {
      console.error('Error connecting to device:', error);
      setConnectionStatus('disconnected');
      setConnectedDevice(null);
      alert('Failed to connect to baby monitor. Please try again.');
    }
  };

  const handleConnectionAnswer = async (answer: RTCSessionDescriptionInit) => {
    if (peerConnectionRef.current) {
      try {
        console.log('Processing connection answer from baby monitor');
        await peerConnectionRef.current.setRemoteDescription(answer);
        setConnectionStatus('connected');
        console.log('Successfully set remote description, connection established!');
      } catch (error) {
        console.error('Error handling connection answer:', error);
        setConnectionStatus('disconnected');
        setConnectedDevice(null);
      }
    }
  };

  const disconnect = async () => {
    try {
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch (error) {
      console.log('Haptics not available:', error);
    }

    console.log('Disconnecting from baby monitor...');

    // Close peer connection
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    
    // Notify baby monitor of disconnection
    if (channelRef.current && connectedDevice) {
      channelRef.current.postMessage({
        type: 'parent-disconnected',
        parentId: `parent-${Date.now()}`,
        deviceId: connectedDevice.id
      });
    }
    
    // Clear video streams
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (audioRef.current) {
      audioRef.current.srcObject = null;
    }

    setConnectionStatus('disconnected');
    setConnectedDevice(null);
  };

  const toggleMute = async () => {
    try {
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch (error) {
      console.log('Haptics not available:', error);
    }

    setIsMuted(!isMuted);
    
    // Also mute/unmute the audio element
    if (audioRef.current) {
      audioRef.current.muted = !isMuted;
    }
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
    }
  };

  // Auto-start scanning when component mounts
  useEffect(() => {
    scanForDevices();
    
    return () => {
      stopScanning();
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }
    };
  }, []);

  // Connected view
  if (connectionStatus === 'connected' && connectedDevice) {
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
            <p className="font-medium text-foreground">{connectedDevice.name}</p>
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
          
          {/* Hidden audio element for audio stream */}
          <audio
            ref={audioRef}
            autoPlay
            muted={isMuted}
            style={{ display: 'none' }}
          />
          
          {/* Loading overlay when no stream */}
          {!videoRef.current?.srcObject && (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground bg-muted">
              <div className="text-center">
                <Camera className="w-16 h-16 mx-auto mb-4" />
                <p className="text-lg">Live Video Stream</p>
                <p className="text-sm">Connecting to baby monitor...</p>
              </div>
            </div>
          )}
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
          {isScanning ? (
            <>
              <Wifi className="w-5 h-5 text-primary animate-pulse" />
              <span className="text-sm text-muted-foreground">Scanning...</span>
            </>
          ) : (
            <>
              <WifiOff className="w-5 h-5 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Not scanning</span>
            </>
          )}
        </div>
      </div>

      <div className="max-w-md mx-auto">
        <Card className="p-6 text-center mb-6">
          <div className="w-20 h-20 mx-auto mb-4 bg-accent rounded-full flex items-center justify-center">
            <Camera className="w-10 h-10 text-accent-foreground" />
          </div>
          <h2 className="text-2xl font-bold mb-2 text-card-foreground">Parent Monitor</h2>
          <p className="text-muted-foreground">
            Connect to available baby monitors on your local network
          </p>
        </Card>

        {/* Connecting State */}
        {connectionStatus === 'connecting' && (
          <Card className="p-6 text-center mb-6">
            <div className="flex justify-center mb-4">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
            <p className="font-medium text-card-foreground">Connecting...</p>
            <p className="text-sm text-muted-foreground">
              Establishing secure connection to {connectedDevice?.name}
            </p>
          </Card>
        )}

        {/* Scan Button */}
        {!isScanning && (
          <Card className="p-4 mb-6">
            <Button 
              onClick={scanForDevices}
              className="w-full"
              size="lg"
            >
              Start Scanning for Devices
            </Button>
          </Card>
        )}

        {/* Available Devices */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-foreground">Available Devices</h3>
            {isScanning && (
              <Button 
                variant="outline" 
                size="sm"
                onClick={stopScanning}
              >
                Stop Scan
              </Button>
            )}
          </div>
          
          {!isScanning && availableDevices.length === 0 ? (
            <Card className="p-6 text-center">
              <div className="text-muted-foreground">
                <WifiOff className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>No scan active</p>
                <p className="text-sm mt-1">Tap "Start Scanning" to find baby monitors</p>
              </div>
            </Card>
          ) : availableDevices.length === 0 ? (
            <Card className="p-6 text-center">
              <div className="text-muted-foreground">
                <Wifi className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>No devices found</p>
                <p className="text-sm mt-1">Make sure baby monitor is active on the same network</p>
              </div>
            </Card>
          ) : (
            availableDevices.map((device) => (
              <Card 
                key={device.id}
                className={`p-4 cursor-pointer smooth-transition hover:shadow-medium ${
                  device.status !== 'active' ? 'opacity-50' : 'hover:scale-105'
                } ${connectionStatus === 'connecting' ? 'pointer-events-none' : ''}`}
                onClick={() => device.status === 'active' && connectionStatus !== 'connecting' && connectToDevice(device)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${
                      device.status === 'active' ? 'bg-success animate-pulse' : 'bg-muted-foreground'
                    }`} />
                    <div>
                      <p className="font-medium text-card-foreground">{device.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {device.platform} • {device.status}
                      </p>
                    </div>
                  </div>
                  
                  {device.status === 'active' && connectionStatus !== 'connecting' && (
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