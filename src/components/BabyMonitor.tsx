import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Camera, Mic, MicOff, Video, VideoOff, ArrowLeft, Wifi } from 'lucide-react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Capacitor } from '@capacitor/core';
import { Device } from '@capacitor/device';
import { Network, type ConnectionStatus } from '@capacitor/network';

interface BabyMonitorProps {
  onBack: () => void;
}

const BabyMonitor = ({ onBack }: BabyMonitorProps) => {
  const [isStreaming, setIsStreaming] = useState(false);
  const [isMicEnabled, setIsMicEnabled] = useState(true);
  const [isCameraEnabled, setIsCameraEnabled] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  the [connectedParents, setConnectedParents] = useState<number>(0);
  const [showNetworkInfo, setShowNetworkInfo] = useState(false);
  const [ipAddress, setIpAddress] = useState('');
  const [port, setPort] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const discoveryIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const webSocketRef = useRef<WebSocket | null>(null);

  const startMonitoring = async () => {
    try {
      await Haptics.impact({ style: ImpactStyle.Medium });
    } catch (error) {
      console.log('Haptics not available:', error);
    }

    try {
      setConnectionStatus('connecting');

      // On native platforms, we need to handle permissions differently
      if (Capacitor.isNativePlatform()) {
        console.log('Running on native platform, requesting native permissions...');

        // Request permissions through native APIs
        try {
          const nav = navigator as Navigator & {
            permissions?: {
              query(options: { name: string }): Promise<PermissionStatus>;
            };
          };
          const permissions = await nav.permissions?.query({ name: 'camera' as PermissionName });
          console.log('Camera permission status:', permissions?.state);
        } catch (e) {
          console.log('Permissions API not available, proceeding with getUserMedia');
        }
      }

      const constraints = {
        video: {
          facingMode: 'user',
          width: { ideal: 640, max: 1280 },
          height: { ideal: 480, max: 720 }
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      };

      console.log('Requesting camera and microphone access...');
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('Stream obtained successfully:', stream);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;

        // Ensure video plays on mobile - important for iOS
        try {
          await videoRef.current.play();
          console.log('Video playback started');
        } catch (playError) {
          console.log('Video playback error (this is normal on some devices):', playError);
        }
      }

      setIsStreaming(true);
      setConnectionStatus('connected');

      // Setup network broadcasting for device discovery
      await setupNetworkBroadcasting();

      console.log('Baby monitor activated and discoverable on network');

    } catch (error: unknown) {
      console.error('Error accessing camera/microphone:', error);

      setConnectionStatus('disconnected');

      // Provide more specific error messages for iOS
      let errorMessage = '';
      const err = error as { name?: string; message?: string };

      if (err.name === 'NotAllowedError') {
        errorMessage = 'Camera and microphone access denied. Please go to Settings > Privacy & Security > Camera/Microphone and allow access for this app.';
      } else if (err.name === 'NotFoundError') {
        errorMessage = 'No camera or microphone found. Please check your device has these capabilities.';
      } else if (err.name === 'NotReadableError') {
        errorMessage = 'Camera or microphone is busy. Please close other apps using camera/microphone and try again.';
      } else if (err.name === 'AbortError') {
        errorMessage = 'Camera access was interrupted. Please try again.';
      } else if (err.name === 'NotSupportedError') {
        errorMessage = 'Camera/microphone not supported on this device or browser.';
      } else {
        errorMessage = `Permission error: ${err.message}. Please check app permissions in device settings.`;
      }

      alert(errorMessage);
    }
  };

  const stopMonitoring = async () => {
    try {
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch (error) {
      console.log('Haptics not available:', error);
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    // Cleanup network broadcasting
    cleanupNetworkBroadcasting();

    setIsStreaming(false);
    setConnectionStatus('disconnected');
    setConnectedParents(0);
  };

  const toggleMic = async () => {
    try {
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch (error) {
      console.log('Haptics not available:', error);
    }

    if (streamRef.current) {
      const audioTrack = streamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !isMicEnabled;
        setIsMicEnabled(!isMicEnabled);
      }
    }
  };

  const toggleCamera = async () => {
    try {
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch (error) {
      console.log('Haptics not available:', error);
    }

    if (streamRef.current) {
      const videoTrack = streamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !isCameraEnabled;
        setIsCameraEnabled(!isCameraEnabled);
      }
    }
  };

  const handleShowNetworkInfo = async () => {
    try {
      const status = await Network.getStatus() as ConnectionStatus & { ipAddress?: string };
      const host = status.ipAddress || window.location.hostname;
      const currentPort = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');
      setIpAddress(host);
      setPort(currentPort);
      setShowNetworkInfo(true);
    } catch (error) {
      console.error('Error getting network info:', error);
    }
  };

  // Setup network broadcasting for device discovery using localStorage and BroadcastChannel
  const setupNetworkBroadcasting = async () => {
    try {
      const deviceInfo = await Device.getInfo();
      const deviceId = await Device.getId();
      const networkStatus = await Network.getStatus() as ConnectionStatus & { ipAddress?: string };

      console.log('Network status:', networkStatus);
      console.log('Setting up baby monitor for network discovery...');

      if (!networkStatus.connected) {
        console.log('Device not connected to network');
        return;
      }

      const networkAddress = networkStatus.ipAddress || window.location.hostname;
      const currentPort = window.location.port ? parseInt(window.location.port) : undefined;

      const deviceData = {
        id: deviceId.identifier || `baby-${Date.now()}`,
        name: `${deviceInfo.model || 'Baby'} Room Monitor`,
        platform: deviceInfo.platform,
        type: 'baby-monitor',
        timestamp: Date.now(),
        status: 'active',
        lastSeen: Date.now(),
        networkId: networkStatus.connectionType,
        networkAddress,
        port: currentPort
      };

      console.log('Device data created:', deviceData);

      // Store device in localStorage with network-like key for discovery
      const networkKey = `zoya-baby-monitor-${deviceData.id}`;
      localStorage.setItem(networkKey, JSON.stringify(deviceData));
      console.log('Device stored in network registry:', networkKey);

      // Create network discovery channel
      const networkChannel = new BroadcastChannel('zoya-network-discovery');

      // Listen for discovery requests from parent monitors
      networkChannel.onmessage = async (event) => {
        const { type, parentId } = event.data;
        console.log('Received network discovery message:', event.data);

        if (type === 'parent-discovery-request') {
          console.log('Parent discovery request received, announcing device...');

          // Respond immediately with device announcement
          setTimeout(() => {
            networkChannel.postMessage({
              type: 'baby-monitor-network-announcement',
              device: {
                ...deviceData,
                lastSeen: Date.now()
              }
            });
          }, 100);
        } else if (type === 'network-connection-request' && event.data.deviceId === deviceData.id) {
          console.log('Connection request received from parent:', parentId);
          await handleParentConnection(parentId, event.data.offer);
        }
      };

      // Periodic device announcement and storage update
      const announceOnNetwork = () => {
        if (!isStreaming) return;

        const updatedDeviceData = {
          ...deviceData,
          lastSeen: Date.now(),
          timestamp: Date.now()
        };

        // Update localStorage
        localStorage.setItem(networkKey, JSON.stringify(updatedDeviceData));

        // Broadcast on network channel
        console.log('Broadcasting device presence on network...');
        networkChannel.postMessage({
          type: 'baby-monitor-network-announcement',
          device: updatedDeviceData
        });
      };

      // Announce immediately
      announceOnNetwork();

      // Set up periodic announcements every 2 seconds
      discoveryIntervalRef.current = setInterval(announceOnNetwork, 2000);

      // Store cleanup function
      const cleanup = () => {
        if (discoveryIntervalRef.current) {
          clearInterval(discoveryIntervalRef.current);
        }
        localStorage.removeItem(networkKey);
        if (networkChannel) {
          networkChannel.close();
        }
      };

      // Store cleanup function for later use
      window.addEventListener('beforeunload', cleanup);

      console.log('Baby monitor network broadcasting started');

    } catch (error) {
      console.error('Error setting up network broadcasting:', error);
    }
  };

  // Handle parent monitor connections via WebRTC
  const handleParentConnection = async (parentId: string, offer: RTCSessionDescriptionInit) => {
    try {
      console.log('Setting up WebRTC connection with parent:', parentId);

      const peerConnection = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      });

      // Add stream tracks to peer connection
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => {
          console.log('Adding track to peer connection:', track.kind);
          peerConnection.addTrack(track, streamRef.current!);
        });
      }

      // Set remote description (offer from parent)
      await peerConnection.setRemoteDescription(offer);

      // Create and send answer
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      console.log('Created answer, sending back to parent...');

      // Send answer back via multiple channels for reliability
      const channel = new BroadcastChannel('zoya-baby-monitor');
      channel.postMessage({
        type: 'connection-answer',
        parentId,
        answer
      });

      // Also store in localStorage for parent to pick up
      const answerKey = `baby-answer-${parentId}`;
      localStorage.setItem(answerKey, JSON.stringify({
        type: 'connection-answer',
        parentId,
        answer,
        timestamp: Date.now()
      }));

      // Store peer connection
      peerConnectionsRef.current.set(parentId, peerConnection);
      setConnectedParents(prev => prev + 1);

      peerConnection.onconnectionstatechange = () => {
        console.log('Peer connection state:', peerConnection.connectionState);
        if (peerConnection.connectionState === 'disconnected' ||
            peerConnection.connectionState === 'failed') {
          handleParentDisconnection(parentId);
        } else if (peerConnection.connectionState === 'connected') {
          console.log('Parent successfully connected!');
        }
      };

    } catch (error) {
      console.error('Error handling parent connection:', error);
    }
  };

  const handleParentDisconnection = (parentId: string) => {
    const peerConnection = peerConnectionsRef.current.get(parentId);
    if (peerConnection) {
      peerConnection.close();
      peerConnectionsRef.current.delete(parentId);
      setConnectedParents(prev => Math.max(0, prev - 1));
    }
  };

  const cleanupNetworkBroadcasting = async () => {
    if (discoveryIntervalRef.current) {
      clearInterval(discoveryIntervalRef.current);
      discoveryIntervalRef.current = null;
    }

    // Close WebSocket connection
    if (webSocketRef.current) {
      try {
        webSocketRef.current.close();
        webSocketRef.current = null;
      } catch (error) {
        console.error('Error closing WebSocket:', error);
      }
    }

    // Send network disconnection announcement
    try {
      const networkChannel = new BroadcastChannel('zoya-network-discovery');
      networkChannel.postMessage({
        type: 'baby-monitor-network-disconnected'
      });
      networkChannel.close();

      console.log('Removed baby monitor from network discovery');
    } catch (error) {
      console.error('Error cleaning up network announcement:', error);
    }

    // Close all peer connections
    peerConnectionsRef.current.forEach(pc => pc.close());
    peerConnectionsRef.current.clear();
  };

  useEffect(() => {
    return () => {
      stopMonitoring();
    };
  }, []);

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
          <div className={`w-2 h-2 rounded-full ${
            connectionStatus === 'connected' ? 'bg-success' :
            connectionStatus === 'connecting' ? 'bg-warning' : 'bg-destructive'
          }`} />
          <span className="text-sm capitalize text-muted-foreground">
            {connectionStatus}
          </span>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-md mx-auto">
        <Card className="p-6 text-center mb-6">
          <div className="w-20 h-20 mx-auto mb-4 bg-secondary rounded-full flex items-center justify-center">
            <Camera className="w-10 h-10 text-secondary-foreground" />
          </div>
          <h2 className="text-2xl font-bold mb-2 text-card-foreground">Baby Monitor Mode</h2>
          <p className="text-muted-foreground mb-6">
            {isStreaming ? 'Your baby is being monitored safely' : 'Ready to start monitoring'}
          </p>

          {/* Video Preview */}
          <div className="relative mb-6 bg-muted rounded-lg overflow-hidden aspect-video">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            {!isCameraEnabled && (
              <div className="absolute inset-0 bg-muted flex items-center justify-center">
                <VideoOff className="w-12 h-12 text-muted-foreground" />
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="space-y-4">
            {!isStreaming ? (
              <Button
                onClick={startMonitoring}
                className="w-full bg-success text-success-foreground hover:bg-success-dark"
                size="lg"
              >
                Start Monitoring
              </Button>
            ) : (
              <>
                <div className="flex gap-3 justify-center">
                  <Button
                    variant={isMicEnabled ? "default" : "destructive"}
                    size="icon"
                    onClick={toggleMic}
                    className="rounded-full w-12 h-12"
                  >
                    {isMicEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
                  </Button>

                  <Button
                    variant={isCameraEnabled ? "default" : "destructive"}
                    size="icon"
                    onClick={toggleCamera}
                    className="rounded-full w-12 h-12"
                  >
                    {isCameraEnabled ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
                  </Button>
                </div>

                <Button
                  onClick={stopMonitoring}
                  variant="destructive"
                  className="w-full"
                  size="lg"
                >
                  Stop Monitoring
                </Button>
              </>
            )}
          </div>
        </Card>

        {/* Connection Info */}
        {isStreaming && (
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Wifi className="w-5 h-5 text-success" />
                <div>
                  <p className="font-medium text-card-foreground">Broadcasting on Local Network</p>
                  <p className="text-sm text-muted-foreground">
                    {connectedParents > 0
                      ? `${connectedParents} parent${connectedParents > 1 ? 's' : ''} connected`
                      : 'Ready for parent connections'
                    }
                  </p>
                </div>
              </div>

              {connectedParents > 0 && (
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-success rounded-full animate-pulse" />
                  <span className="text-sm font-medium text-success">{connectedParents}</span>
                </div>
              )}
            </div>

            <div className="mt-4 text-center">
              {!showNetworkInfo ? (
                <Button size="sm" onClick={handleShowNetworkInfo}>
                  Show IP & Port
                </Button>
              ) : (
                <div className="text-sm text-muted-foreground">
                  <p>IP: {ipAddress}</p>
                  <p>Port: {port}</p>
                </div>
              )}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
};

export default BabyMonitor;
