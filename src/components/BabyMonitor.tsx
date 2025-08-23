import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Camera, Mic, MicOff, Video, VideoOff, ArrowLeft, Wifi } from 'lucide-react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

interface BabyMonitorProps {
  onBack: () => void;
}

const BabyMonitor = ({ onBack }: BabyMonitorProps) => {
  const [isStreaming, setIsStreaming] = useState(false);
  const [isMicEnabled, setIsMicEnabled] = useState(true);
  const [isCameraEnabled, setIsCameraEnabled] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startMonitoring = async () => {
    try {
      await Haptics.impact({ style: ImpactStyle.Medium });
    } catch (error) {
      console.log('Haptics not available:', error);
    }

    try {
      setConnectionStatus('connecting');
      
      // Check if mediaDevices is supported
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Camera/microphone not supported on this device');
        setConnectionStatus('disconnected');
        return;
      }

      // For iOS, we need to request permissions more explicitly
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

      console.log('Requesting camera and microphone permissions...');
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('Permissions granted, stream obtained:', stream);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        
        // Ensure video plays on mobile - important for iOS
        await videoRef.current.play();
      }

      setIsStreaming(true);
      setConnectionStatus('connected');
      
      // Store device ID for parent monitors to discover
      localStorage.setItem('babyMonitorActive', 'true');
      localStorage.setItem('babyMonitorId', `baby-${Date.now()}`);
      localStorage.setItem('babyMonitorName', 'Baby Room Monitor');
      
    } catch (error) {
      console.error('Error accessing camera/microphone:', error);
      let errorMessage = 'Unable to access camera and microphone. ';
      
      if (error.name === 'NotAllowedError') {
        errorMessage += 'Please allow camera and microphone access in your browser settings.';
      } else if (error.name === 'NotFoundError') {
        errorMessage += 'No camera or microphone found on this device.';
      } else if (error.name === 'NotReadableError') {
        errorMessage += 'Camera or microphone is already in use by another application.';
      } else {
        errorMessage += 'Please check your device permissions and try again.';
      }
      
      alert(errorMessage);
      setConnectionStatus('disconnected');
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

    // Remove from local discovery
    localStorage.removeItem('babyMonitorActive');
    localStorage.removeItem('babyMonitorId');
    localStorage.removeItem('babyMonitorName');

    setIsStreaming(false);
    setConnectionStatus('disconnected');
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
            <div className="flex items-center gap-3">
              <Wifi className="w-5 h-5 text-success" />
              <div>
                <p className="font-medium text-card-foreground">Broadcasting on Local Network</p>
                <p className="text-sm text-muted-foreground">Parents can connect to watch</p>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
};

export default BabyMonitor;