import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Camera, ArrowLeft, Wifi, WifiOff, Loader2, Volume2, VolumeX } from 'lucide-react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Capacitor } from '@capacitor/core';
import { Network } from '@capacitor/network';
import { ensureWebRTCGlobals, observeVideo } from '@/lib/webrtc';




interface BabyMonitorDevice {
  id: string;
  name: string;
  platform?: string;
  type: string;
  status: 'active' | 'inactive';
  timestamp: number;
  lastSeen: number;
  connectionMethod?: 'websocket' | 'broadcast' | 'manual' | 'stored' | 'bonjour';
  networkAddress?: string;
  port?: number;
  txtRecord?: any;
}

interface ParentMonitorProps {
  onBack: () => void;
}

const ParentMonitor = ({ onBack }: ParentMonitorProps) => {
  const [discoveredDevices, setDiscoveredDevices] = useState<BabyMonitorDevice[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<BabyMonitorDevice | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const bonjourBrowserRef = useRef<any>(null);
  const bonjourInstanceRef = useRef<any>(null);

  const [manualIp, setManualIp] = useState('');
  const [manualPort, setManualPort] = useState('');

 // Access the Capacitor HTTP plugin if available
  interface HttpLike {
    post: (options: { url: string; data?: unknown; headers?: Record<string, string> }) => Promise<{ data: unknown; status: number }>;
    get: (options: { url: string }) => Promise<{ data: unknown; status: number }>;
  }

  const getHttp = (): HttpLike | null => {
    const cap = Capacitor as unknown as { Plugins?: { Http?: HttpLike } };
    return cap.Plugins?.Http ?? null;
  };

  const httpPost = async (url: string, data: unknown) => {
    const plugin = getHttp();
    if (plugin) {
      return plugin.post({ url, data });
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return { data: await res.json(), status: res.status };
  };

  const httpGet = async (url: string) => {
    const plugin = getHttp();
    if (plugin) {
      return plugin.get({ url });
    }
    const res = await fetch(url);
    return { data: await res.json(), status: res.status };
  };

  useEffect(() => {
    ensureWebRTCGlobals();
  }, []);


  const connectManual = () => {
    if (!manualIp || !manualPort) return;
    const device: BabyMonitorDevice = {
      id: `manual-${manualIp}-${manualPort}`,
      name: `Manual Device (${manualIp})`,
      type: 'baby-monitor',
      status: 'active',
      timestamp: Date.now(),
      lastSeen: Date.now(),
      connectionMethod: 'manual',
      networkAddress: manualIp,
      port: parseInt(manualPort, 10)
    };
    connectToDevice(device);
  };

  const stopScanning = () => {
    console.log('Stopping network device scanning...');
    setIsScanning(false);
    setDiscoveredDevices([]);
  };

  const startNetworkDiscovery = async () => {
    try {
      console.log('Starting network device discovery...');
      
      // Listen for baby monitor broadcasts
      const networkChannel = new BroadcastChannel('zoya-network-discovery');
      
      const handleNetworkMessage = (event: MessageEvent) => {
        console.log('Received network message:', event.data);
        
        if (event.data.type === 'baby-monitor-active' || event.data.type === 'baby-monitor-heartbeat') {
          const deviceData = event.data.device;
          
          const device: BabyMonitorDevice = {
            id: `network-${deviceData.id}`,
            name: deviceData.name || `Baby Monitor (${deviceData.host})`,
            type: 'baby-monitor',
            status: 'active',
            timestamp: deviceData.timestamp || Date.now(),
            lastSeen: Date.now(),
            connectionMethod: 'broadcast',
            networkAddress: deviceData.host,
            port: deviceData.port,
            platform: deviceData.platform
          };
          
          setDiscoveredDevices(prev => {
            // Update existing or add new
            const existingIndex = prev.findIndex(d => d.id === device.id);
            if (existingIndex >= 0) {
              const updated = [...prev];
              updated[existingIndex] = { ...updated[existingIndex], ...device, lastSeen: Date.now() };
              return updated;
            } else {
              console.log('Adding discovered device:', device);
              return [...prev, device];
            }
          });
        } else if (event.data.type === 'baby-monitor-network-disconnected') {
          // Remove disconnected devices
          setDiscoveredDevices(prev => 
            prev.filter(device => device.connectionMethod !== 'broadcast')
          );
        }
      };
      
      networkChannel.addEventListener('message', handleNetworkMessage);
      
      // Request active devices to announce themselves
      networkChannel.postMessage({
        type: 'parent-requesting-devices'
      });
      
      // Store reference for cleanup  
      bonjourBrowserRef.current = { 
        stop: () => {
          networkChannel.removeEventListener('message', handleNetworkMessage);
          networkChannel.close();
        }
      };
      
      console.log('Network discovery started');
      
    } catch (error) {
      console.error('Error starting network discovery:', error);
    }
  };

  const stopNetworkDiscovery = () => {
    try {
      const browser = bonjourBrowserRef.current;
      
      if (browser && browser.stop) {
        browser.stop();
        bonjourBrowserRef.current = null;
      }
      
      console.log('Network discovery stopped');
    } catch (error) {
      console.error('Error stopping network discovery:', error);
    }
  };

  const scanForDevices = async () => {
    console.log('Starting device scan...');
    setIsScanning(true);
    setDiscoveredDevices([]);

    try {
      // Start network discovery
      await startNetworkDiscovery();

      // Check localStorage for active baby monitors (fallback)
      const storedDevices = localStorage.getItem('babyMonitorActive');
      if (storedDevices) {
        try {
          const deviceInfo = JSON.parse(storedDevices);
          console.log('Found stored device info:', deviceInfo);
          
          const device: BabyMonitorDevice = {
            id: `stored-${deviceInfo.address}-${deviceInfo.port}`,
            name: `Stored Baby Monitor (${deviceInfo.address})`,
            type: 'baby-monitor',
            status: 'active',
            timestamp: Date.now(),
            lastSeen: Date.now(),
            connectionMethod: 'stored',
            networkAddress: deviceInfo.address,
            port: deviceInfo.port
          };
          
          setDiscoveredDevices(prev => [...prev, device]);
        } catch (parseError) {
          console.error('Error parsing stored device info:', parseError);
        }
      }

      // Stop scanning after timeout
      // Scan for a longer duration to find devices
      setTimeout(() => {
        console.log('Network scan completed');
        setIsScanning(false);
        stopNetworkDiscovery();
      }, 15000);

    } catch (error) {
      console.error('Error during device scan:', error);
      setIsScanning(false);
    }
  };

  const connectToDevice = async (device: BabyMonitorDevice) => {
    if (connectedDevice) {
      console.log('Already connected to a device');
      return;
    }

    setIsConnecting(true);
    ensureWebRTCGlobals();
    console.log('Connecting to network baby monitor:', device);

    try {
      // Create WebRTC peer connection
      const peerConnection = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      });

      peerConnectionRef.current = peerConnection;

      // Handle incoming stream
      peerConnection.ontrack = (event) => {
        console.log('Received remote stream:', event.streams[0]);
        if (remoteVideoRef.current && event.streams[0]) {
         // Prepare element for iOSRTC before attaching stream
          remoteVideoRef.current.setAttribute('playsinline', 'true');
          observeVideo(remoteVideoRef.current);
          remoteVideoRef.current.srcObject = event.streams[0];
          remoteStreamRef.current = event.streams[0];
          try {
            remoteVideoRef.current.play();
          } catch (err) {
            console.log('Remote video playback error:', err);
          }
        }
      };

      // Create offer
      const offer = await peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });

      await peerConnection.setLocalDescription(offer);
      console.log('Created offer, sending to baby monitor...');

      const parentId = `parent-${Date.now()}`;
      const baseUrl = `http://${device.networkAddress}:${device.port}`;

      console.log('Attempting to connect to baby monitor at:', baseUrl);

      // Send WebRTC offer to baby monitor via HTTP
      const sendOffer = async () => {
        const url = `${baseUrl}/webrtc/offer`;
        const payload = { parentId, offer };
        
        console.log('Sending offer to:', url, payload);
        
        try {
          let response;
          if (Capacitor.isNativePlatform()) {
            response = await httpPost(url, payload);
            console.log('Native HTTP response:', response);
            return typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
          } else {
            const res = await fetch(url, {
              method: 'POST',
              headers: { 
                'Content-Type': 'application/json',
                'Accept': 'application/json'
              },
              body: JSON.stringify(payload),
              mode: 'cors'
            });
            
            console.log('Fetch response status:', res.status, res.statusText);
            
            if (!res.ok) {
              const errorText = await res.text();
              console.error('HTTP error response:', errorText);
              throw new Error(`HTTP ${res.status}: ${res.statusText} - ${errorText}`);
            }
            
            const responseData = await res.json();
            console.log('Fetch response data:', responseData);
            return responseData;
          }
        } catch (error) {
          console.error('Error in sendOffer:', error);
          throw error;
        }
      };

      const { answer } = await sendOffer();
      console.log('Received answer from baby monitor');

      await peerConnection.setRemoteDescription(answer);

      // Set up ICE candidate exchange
      peerConnection.onicecandidate = async (event) => {
        if (event.candidate) {
          console.log('Sending ICE candidate to baby monitor');
          const url = `${baseUrl}/webrtc/ice-candidate`;
          const data = { parentId, candidate: event.candidate };
          try {
            if (Capacitor.isNativePlatform()) {
              await httpPost(url, data);
            } else {
              await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
              });
            }
          } catch (error) {
            console.error('Failed to send ICE candidate:', error);
          }
        }
      };

      // Poll for ICE candidates from baby monitor
      const pollForCandidates = async () => {
        try {
const url = `${baseUrl}/webrtc/get-candidates/${parentId}`;
          let candidates: RTCIceCandidateInit[] = [];
          if (Capacitor.isNativePlatform()) {
            const res = await httpGet(url);
            if (res.status === 200) {
              const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
              candidates = (data.candidates || []) as RTCIceCandidateInit[];
            }
          } else {
            const response = await fetch(url);
            if (response.ok) {
              const data = await response.json();
              candidates = (data.candidates || []) as RTCIceCandidateInit[];
            }
          }
          for (const candidate of candidates) {
            console.log('Received ICE candidate from baby monitor');
            await peerConnection.addIceCandidate(candidate);
          }
        } catch (error) {
          console.error('Failed to poll for ICE candidates:', error);
        }
      };

      // Start polling for ICE candidates
      const candidateInterval = setInterval(pollForCandidates, 1000);

      // Connection state monitoring
      peerConnection.onconnectionstatechange = () => {
        console.log('Peer connection state:', peerConnection.connectionState);
        if (peerConnection.connectionState === 'connected') {
          console.log('Successfully connected to baby monitor!');
          setConnectedDevice(device);
          setIsConnecting(false);
          clearInterval(candidateInterval);
        } else if (peerConnection.connectionState === 'disconnected' ||
                   peerConnection.connectionState === 'failed') {
          clearInterval(candidateInterval);
          handleDisconnect();
        }
      };

      // Connection timeout
      setTimeout(() => {
        if (!connectedDevice) {
          console.log('Connection timeout - failed to connect to baby monitor');
          setIsConnecting(false);
          clearInterval(candidateInterval);
          peerConnection.close();
        }
      }, 15000);

    } catch (error) {
      console.error('Error connecting to baby monitor:', error);
      console.error('Full error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
      setIsConnecting(false);
    }
  };

  const handleDisconnect = () => {
    console.log('Handling disconnect...');

    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }

    if (remoteStreamRef.current) {
      remoteStreamRef.current.getTracks().forEach(track => track.stop());
      remoteStreamRef.current = null;
    }

    setConnectedDevice(null);
    setIsConnecting(false);
  };

  const disconnect = async () => {
    try {
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch (error) {
      console.log('Haptics not available:', error);
    }

    handleDisconnect();
  };

  const toggleMute = async () => {
    try {
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch (error) {
      console.log('Haptics not available:', error);
    }

    setIsMuted(!isMuted);

    if (remoteVideoRef.current) {
      remoteVideoRef.current.muted = !isMuted;
    }
  };

  // Auto-start scanning when component mounts
  useEffect(() => {
    scanForDevices();

    return () => {
      stopNetworkDiscovery();
      handleDisconnect();
    };
  }, []);

  // Connected view
  if (connectedDevice) {
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
            ref={remoteVideoRef}
            autoPlay
            playsInline
            muted={isMuted}
            className="absolute inset-0 w-full h-full object-cover"
          />

          {/* Loading overlay when no stream */}
          {!remoteStreamRef.current && (
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
        {isConnecting && (
          <Card className="p-6 text-center mb-6">
            <div className="flex justify-center mb-4">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
            <p className="font-medium text-card-foreground">Connecting...</p>
            <p className="text-sm text-muted-foreground">
              Establishing secure connection to baby monitor
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

        {/* Manual Connect */}
        <Card className="p-4 mb-6">
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="manual-ip">IP Address</Label>
                <Input
                  id="manual-ip"
                  value={manualIp}
                  onChange={(e) => setManualIp(e.target.value)}
                  placeholder="192.168.1.100"
                />
              </div>
              <div>
                <Label htmlFor="manual-port">Port</Label>
                <Input
                  id="manual-port"
                  value={manualPort}
                  onChange={(e) => setManualPort(e.target.value)}
                  placeholder="5000"
                />
              </div>
            </div>
            <Button
              onClick={connectManual}
              className="w-full"
              disabled={!manualIp || !manualPort || isConnecting}
            >
              Connect Manually
            </Button>
          </div>
        </Card>

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

          {!isScanning && discoveredDevices.length === 0 ? (
            <Card className="p-6 text-center">
              <div className="text-muted-foreground">
                <WifiOff className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>No scan active</p>
                <p className="text-sm mt-1">Tap "Start Scanning" to find baby monitors on local network</p>
              </div>
            </Card>
          ) : discoveredDevices.length === 0 ? (
            <Card className="p-6 text-center">
              <div className="text-muted-foreground">
                <Wifi className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>No devices found</p>
                <p className="text-sm mt-1">Make sure baby monitor is active on the same WiFi network</p>
              </div>
            </Card>
          ) : (
            discoveredDevices.map((device) => (
              <Card
                key={device.id}
                className={`p-4 cursor-pointer smooth-transition hover:shadow-medium ${
                  device.status !== 'active' ? 'opacity-50' : 'hover:scale-105'
                } ${isConnecting ? 'pointer-events-none' : ''}`}
                onClick={() => device.status === 'active' && !isConnecting && connectToDevice(device)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${
                      device.status === 'active' ? 'bg-success animate-pulse' : 'bg-muted-foreground'
                    }`} />
                    <div>
                      <p className="font-medium text-card-foreground">{device.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {device.platform} • {device.connectionMethod || 'network'}
                      </p>
                    </div>
                  </div>

                  {device.status === 'active' && !isConnecting && (
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
