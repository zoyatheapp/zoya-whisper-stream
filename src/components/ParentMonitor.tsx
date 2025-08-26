import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Camera, ArrowLeft, Wifi, WifiOff, Loader2, Volume2, VolumeX } from 'lucide-react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Capacitor } from '@capacitor/core';
import { Network } from '@capacitor/network';

interface BabyMonitorDevice {
  id: string;
  name: string;
  platform?: string;
  type: string;
  status: 'active' | 'inactive';
  timestamp: number;
  lastSeen: number;
  connectionMethod?: 'websocket' | 'broadcast' | 'manual';
  networkAddress?: string;
  port?: number;
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

  const [manualIp, setManualIp] = useState('');
  const [manualPort, setManualPort] = useState('');

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

  const scanForDevices = async () => {
    setIsScanning(true);
    console.log('Scanning for baby monitors on local network...');

    try {
      const networkStatus = await Network.getStatus();
      console.log('Network status:', networkStatus);

      if (!networkStatus.connected) {
        console.log('Device not connected to network');
        setIsScanning(false);
        return;
      }

      // Clear previous devices
      setDiscoveredDevices([]);

      // Method 1: Scan localStorage for network-registered devices
      const scanStorageDevices = () => {
        console.log('Scanning localStorage for network devices...');
        const foundDevices: BabyMonitorDevice[] = [];

        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith('zoya-baby-monitor-')) {
            try {
              const deviceData = JSON.parse(localStorage.getItem(key) || '{}');
              console.log('Found stored device:', deviceData);

              // Check if device is still active (last seen within 10 seconds)
              if (deviceData.lastSeen && (Date.now() - deviceData.lastSeen) < 10000) {
                foundDevices.push({
                  ...deviceData,
                  connectionMethod: 'network'
                });
              }
            } catch (error) {
              console.error('Error parsing stored device:', error);
            }
          }
        }

        if (foundDevices.length > 0) {
          console.log(`Found ${foundDevices.length} devices in network storage`);
          setDiscoveredDevices(foundDevices);
        }
      };

      // Method 2: Network broadcast channel scanning
      const networkChannel = new BroadcastChannel('zoya-network-discovery');

      const handleNetworkAnnouncement = (event: MessageEvent) => {
        const { type, device } = event.data;
        console.log('Received network discovery message:', event.data);

        if (type === 'baby-monitor-network-announcement' && device) {
          console.log('Found baby monitor via network broadcast:', device);

          setDiscoveredDevices(prevDevices => {
            const existingIndex = prevDevices.findIndex(d => d.id === device.id);
            const updatedDevice = {
              ...device,
              lastSeen: Date.now(),
              connectionMethod: 'broadcast'
            };

            if (existingIndex >= 0) {
              const newDevices = [...prevDevices];
              newDevices[existingIndex] = updatedDevice;
              return newDevices;
            } else {
              return [...prevDevices, updatedDevice];
            }
          });
        }
      };

      networkChannel.onmessage = handleNetworkAnnouncement;

      // Send discovery request immediately
      console.log('Sending parent discovery request...');
      networkChannel.postMessage({
        type: 'parent-discovery-request',
        parentId: `parent-${Date.now()}`,
        timestamp: Date.now()
      });

      // Scan storage immediately
      scanStorageDevices();

      // Repeat discovery request every 2 seconds while scanning
      const discoveryInterval = setInterval(() => {
        console.log('Sending periodic discovery request...');
        networkChannel.postMessage({
          type: 'parent-discovery-request',
          parentId: `parent-${Date.now()}`,
          timestamp: Date.now()
        });

        // Also rescan storage
        scanStorageDevices();
      }, 2000);

      // Set up periodic cleanup of old devices
      const cleanupInterval = setInterval(() => {
        setDiscoveredDevices(prevDevices =>
          prevDevices.filter(device =>
            device.lastSeen && (Date.now() - device.lastSeen) < 15000 // Remove devices not seen in 15 seconds
          )
        );
      }, 5000);

      // Stop scanning after 10 seconds
      setTimeout(() => {
        setIsScanning(false);
        clearInterval(discoveryInterval);
        clearInterval(cleanupInterval);
        networkChannel.close();
        console.log('Network device scanning completed');
      }, 10000);

    } catch (error) {
      console.error('Error scanning for network devices:', error);
      setIsScanning(false);
    }
  };

  const connectToDevice = async (device: BabyMonitorDevice) => {
    if (connectedDevice) {
      console.log('Already connected to a device');
      return;
    }

    setIsConnecting(true);
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
          remoteVideoRef.current.srcObject = event.streams[0];
          remoteStreamRef.current = event.streams[0];
        }
      };

      // Create offer
      const offer = await peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });

      await peerConnection.setLocalDescription(offer);
      console.log('Created offer, sending to network baby monitor...');

      const parentId = `parent-${Date.now()}`;

      // Send connection request via network discovery channel
      const networkChannel = new BroadcastChannel('zoya-network-discovery');

      networkChannel.postMessage({
        type: 'network-connection-request',
        parentId,
        deviceId: device.id,
        offer
      });

      // Set up ICE candidate handling
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          console.log('Sending ICE candidate to baby monitor');
          networkChannel.postMessage({
            type: 'ice-candidate',
            parentId,
            deviceId: device.id,
            candidate: event.candidate
          });
        }
      };

      console.log('WebRTC connection request sent to baby monitor at', device.networkAddress);

      // Listen for answer and ICE candidates via network channel
      const handleNetworkAnswer = async (event: MessageEvent) => {
        const { type, answer, candidate, parentId: responseParentId } = event.data;
        
        if (responseParentId === parentId) {
          if (type === 'connection-answer') {
            console.log('Received answer from network baby monitor at', device.networkAddress);
            try {
              await peerConnection.setRemoteDescription(answer);
              setConnectedDevice(device);
              setIsConnecting(false);
              console.log('Successfully connected to baby monitor!');
            } catch (error) {
              console.error('Error setting remote description:', error);
              setIsConnecting(false);
            }
          } else if (type === 'ice-candidate-response' && candidate) {
            console.log('Received ICE candidate from baby monitor');
            try {
              await peerConnection.addIceCandidate(candidate);
            } catch (error) {
              console.error('Error adding ICE candidate:', error);
            }
          }
        }
      };

      networkChannel.onmessage = handleNetworkAnswer;

      // Connection timeout
      setTimeout(() => {
        if (!connectedDevice) {
          console.log('Connection timeout - failed to connect to baby monitor at', device.networkAddress);
          setIsConnecting(false);
          peerConnection.close();
          networkChannel.close();
        }
      }, 15000);

      peerConnection.onconnectionstatechange = () => {
        console.log('Peer connection state:', peerConnection.connectionState);
        if (peerConnection.connectionState === 'connected') {
          console.log('Successfully connected to network baby monitor!');
        } else if (peerConnection.connectionState === 'disconnected' ||
                   peerConnection.connectionState === 'failed') {
          handleDisconnect();
        }
      };

    } catch (error) {
      console.error('Error connecting to baby monitor at', device.networkAddress + ':' + device.port, error);
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
        <div className="relative h-[calc(100vh-140px)] bg-muted flex items and justify-center">
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            muted={isMuted}
            className="w-full h-full object-cover"
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
