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
  const [connectedParents, setConnectedParents] = useState<number>(0);
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
      // Use WebRTC to discover local IP address
      const localIP = await getLocalIPAddress();
      const currentPort = '8080'; // Use a consistent port for baby monitor
      
      setIpAddress(localIP);
      setPort(currentPort);
      setShowNetworkInfo(true);
      
      console.log('Network info - IP:', localIP, 'Port:', currentPort);
    } catch (error) {
      console.error('Error getting network info:', error);
      // Fallback to basic info
      setIpAddress(window.location.hostname);
      setPort(window.location.port || '80');
      setShowNetworkInfo(true);
    }
  };

  // Function to get actual local IP address using WebRTC
  const getLocalIPAddress = (): Promise<string> => {
    return new Promise((resolve, reject) => {
      const rtc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });

      let candidates: string[] = [];

      // Create a dummy data channel
      rtc.createDataChannel('');

      rtc.onicecandidate = (e) => {
        if (e.candidate) {
          const candidate = e.candidate.candidate;
          console.log('ICE candidate:', candidate);
          
          // Extract IP from candidate string
          const match = candidate.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
          if (match && match[1]) {
            const ip = match[1];
            console.log('Found IP candidate:', ip);
            
            // Skip localhost and other non-useful IPs
            if (!ip.startsWith('127.') && !ip.startsWith('0.') && ip !== '0.0.0.0' && !ip.startsWith('169.254.')) {
              candidates.push(ip);
            }
          }
        }
      };

      rtc.onicegatheringstatechange = () => {
        if (rtc.iceGatheringState === 'complete') {
          rtc.close();
          
          if (candidates.length > 0) {
            // Prioritize local network IPs
            const localIPs = candidates.filter(ip => 
              ip.startsWith('192.168.') || 
              ip.startsWith('10.') || 
              (ip.startsWith('172.') && parseInt(ip.split('.')[1]) >= 16 && parseInt(ip.split('.')[1]) <= 31)
            );
            
            console.log('Local IP candidates:', localIPs);
            console.log('All IP candidates:', candidates);
            
            // Use local network IP if available, otherwise use first available
            const selectedIP = localIPs.length > 0 ? localIPs[0] : candidates[0];
            console.log('Selected IP:', selectedIP);
            resolve(selectedIP);
          } else {
            reject(new Error('Could not determine local IP address'));
          }
        }
      };

      // Create offer to start ICE gathering
      rtc.createOffer()
        .then(offer => rtc.setLocalDescription(offer))
        .catch(reject);

      // Timeout after 8 seconds to allow more candidates
      setTimeout(() => {
        rtc.close();
        
        if (candidates.length > 0) {
          // Prioritize local network IPs
          const localIPs = candidates.filter(ip => 
            ip.startsWith('192.168.') || 
            ip.startsWith('10.') || 
            (ip.startsWith('172.') && parseInt(ip.split('.')[1]) >= 16 && parseInt(ip.split('.')[1]) <= 31)
          );
          
          console.log('Timeout - Local IP candidates:', localIPs);
          console.log('Timeout - All IP candidates:', candidates);
          
          // Use local network IP if available, otherwise use first available
          const selectedIP = localIPs.length > 0 ? localIPs[0] : candidates[0];
          console.log('Timeout - Selected IP:', selectedIP);
          resolve(selectedIP);
        } else {
          reject(new Error('Timeout getting local IP address'));
        }
      }, 8000);
    });
  };

  // HTTP server simulation for WebRTC signaling
  const setupHTTPSignalingServer = () => {
    console.log('Setting up HTTP signaling server simulation...');
    
    // Store for WebRTC signaling data
    const signalingData = {
      offers: new Map(),
      answers: new Map(),
      candidates: new Map()
    };

    // Simulate HTTP endpoints using localStorage and polling
    const serverEndpoints = {
      handleOffer: async (parentId: string, offer: RTCSessionDescriptionInit) => {
        console.log('Received WebRTC offer from parent:', parentId);
        const answer = await handleParentConnection(parentId, offer);
        return { answer };
      },

      handleICECandidate: (parentId: string, candidate: RTCIceCandidate) => {
        console.log('Received ICE candidate from parent:', parentId);
        if (!signalingData.candidates.has(parentId)) {
          signalingData.candidates.set(parentId, []);
        }
        signalingData.candidates.get(parentId).push(candidate);
        
        // Apply candidate to existing peer connection
        const peerConnection = peerConnectionsRef.current.get(parentId);
        if (peerConnection) {
          peerConnection.addIceCandidate(candidate);
        }
        return { success: true };
      },

      getCandidates: (parentId: string) => {
        const candidates = signalingData.candidates.get(parentId) || [];
        signalingData.candidates.set(parentId, []); // Clear after retrieval
        return { candidates };
      }
    };

    // Store endpoints in window for access by fetch simulation
    (window as any).babyMonitorSignaling = serverEndpoints;
    
    // Intercept fetch requests to baby monitor endpoints
    const originalFetch = window.fetch;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      
      // Check if this is a request to our baby monitor endpoints
      if (url.includes('/webrtc/')) {
        console.log('Intercepting WebRTC signaling request:', url);
        
        try {
          const body = init?.body ? JSON.parse(init.body as string) : {};
          let result;
          
          if (url.includes('/webrtc/offer')) {
            result = await serverEndpoints.handleOffer(body.parentId, body.offer);
          } else if (url.includes('/webrtc/ice-candidate')) {
            result = serverEndpoints.handleICECandidate(body.parentId, body.candidate);
          } else if (url.includes('/webrtc/get-candidates/')) {
            const parentId = url.split('/').pop();
            result = serverEndpoints.getCandidates(parentId!);
          }
          
          // Return a fake successful response
          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        } catch (error) {
          console.error('Error in fetch simulation:', error);
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
      
      // For non-baby monitor requests, use original fetch
      return originalFetch(input, init);
    };
    
    console.log('HTTP signaling server ready with fetch interception');
  };

  // Setup network broadcasting for device discovery
  const setupNetworkBroadcasting = async () => {
    try {
      const deviceInfo = await Device.getInfo();
      let deviceIdentifier: string;
      try {
        if (Capacitor.isNativePlatform()) {
          const idInfo = await Device.getId();
          deviceIdentifier = idInfo.identifier ?? `baby-${Date.now()}`;
        } else {
          deviceIdentifier = `baby-${Date.now()}`;
        }
      } catch (err) {
        console.warn('Device ID not available:', err);
        deviceIdentifier = `baby-${Date.now()}`;
      }

      console.log('Setting up baby monitor for network discovery...');

      // Get local IP address
      const localIP = await getLocalIPAddress();
      const port = window.location.port ? parseInt(window.location.port) : 8080;

      const deviceData = {
        id: deviceIdentifier,
        name: `${deviceInfo.model || 'Baby'} Room Monitor`,
        platform: deviceInfo.platform,
        type: 'baby-monitor',
        timestamp: Date.now(),
        status: 'active',
        lastSeen: Date.now(),
        networkAddress: localIP,
        port: port
      };

      console.log('Device data created:', deviceData);

      // Setup HTTP signaling server
      setupHTTPSignalingServer();

      console.log('Baby monitor network setup completed');

    } catch (error) {
      console.error('Error setting up network broadcasting:', error);
    }
  };

  // Handle parent monitor connections via WebRTC
  const handleICECandidate = async (parentId: string, candidate: RTCIceCandidate) => {
    try {
      const peerConnection = peerConnectionsRef.current.get(parentId);
      if (peerConnection && candidate) {
        console.log('Adding ICE candidate from parent:', parentId);
        await peerConnection.addIceCandidate(candidate);
      }
    } catch (error) {
      console.error('Error handling ICE candidate:', error);
    }
  };

  const handleParentConnection = async (parentId: string, offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> => {
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

      console.log('Created answer for parent:', parentId);

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

      return answer;

    } catch (error) {
      console.error('Error handling parent connection:', error);
      throw error;
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
