import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:video_player/video_player.dart';
import '../providers/video_provider.dart';
import '../models/video_item.dart';
import 'engagement_sidebar.dart';
import 'metadata_overlay.dart';

class VideoPlayerWidget extends StatefulWidget {
  final VideoItem videoItem;
  final bool isActive;

  const VideoPlayerWidget({
    super.key,
    required this.videoItem,
    required this.isActive,
  });

  @override
  State<VideoPlayerWidget> createState() => _VideoPlayerWidgetState();
}

class _VideoPlayerWidgetState extends State<VideoPlayerWidget>
    with SingleTickerProviderStateMixin {
  late AnimationController _animationController;
  late Animation<double> _fadeAnimation;
  bool _showControls = true;
  Timer? _hideControlsTimer;

  @override
  void initState() {
    super.initState();
    _animationController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 300),
    );
    _fadeAnimation = CurvedAnimation(
      parent: _animationController,
      curve: Curves.easeInOut,
    );
    _startHideControlsTimer();
  }

  @override
  void didUpdateWidget(VideoPlayerWidget oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.isActive != widget.isActive && widget.isActive) {
      _initializeAndPlay();
    } else if (oldWidget.isActive != widget.isActive && !widget.isActive) {
      _pauseVideo();
    }
  }

  @override
  void dispose() {
    _hideControlsTimer?.cancel();
    _animationController.dispose();
    super.dispose();
  }

  void _initializeAndPlay() {
    final provider = context.read<VideoProvider>();
    provider.initializeController(widget.videoItem.id, widget.videoItem.videoUrl);
    provider.playVideo(widget.videoItem.id);
  }

  void _pauseVideo() {
    final provider = context.read<VideoProvider>();
    provider.pauseVideo(widget.videoItem.id);
  }

  void _togglePlayPause() {
    final provider = context.read<VideoProvider>();
    provider.togglePlayPause(widget.videoItem.id);
    
    setState(() {
      _showControls = true;
      _animationController.forward(from: 0);
    });
    
    _startHideControlsTimer();
  }

  void _startHideControlsTimer() {
    _hideControlsTimer?.cancel();
    _hideControlsTimer = Timer(const Duration(seconds: 3), () {
      if (mounted) {
        setState(() {
          _showControls = false;
          _animationController.reverse();
        });
      }
    });
  }

  void _handleTap() {
    _togglePlayPause();
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: _handleTap,
      child: Container(
        color: Colors.black,
        width: double.infinity,
        height: double.infinity,
        child: Stack(
          children: [
            // Video Player
            Center(
              child: AspectRatio(
                aspectRatio: 9 / 16,
                child: FittedBox(
                  fit: BoxFit.cover,
                  child: SizedBox(
                    width: MediaQuery.of(context).size.width,
                    height: MediaQuery.of(context).size.height,
                    child: _buildVideoPlayer(),
                  ),
                ),
              ),
            ),
            
            // Gradient Overlay
            Positioned(
              bottom: 0,
              left: 0,
              right: 0,
              height: 200,
              child: Container(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.bottomCenter,
                    end: Alignment.topCenter,
                    colors: [
                      Colors.black.withOpacity(0.8),
                      Colors.transparent,
                    ],
                  ),
                ),
              ),
            ),
            
            // Play/Pause Indicator
            AnimatedBuilder(
              animation: _fadeAnimation,
              builder: (context, child) {
                return Opacity(
                  opacity: _showControls ? _fadeAnimation.value : 0,
                  child: child!,
                );
              },
              child: Center(
                child: Consumer<VideoProvider>(
                  builder: (context, provider, child) {
                    final isPlaying = provider.isPlaying && 
                        provider.currentVideoId == widget.videoItem.id;
                    return Container(
                      width: 80,
                      height: 80,
                      decoration: BoxDecoration(
                        color: Colors.black.withOpacity(0.5),
                        shape: BoxShape.circle,
                      ),
                      child: Icon(
                        isPlaying ? Icons.pause_rounded : Icons.play_arrow_rounded,
                        size: 50,
                        color: Colors.white,
                      ),
                    );
                  },
                ),
              ),
            ),
            
            // Metadata Overlay (Bottom Left)
            Positioned(
              bottom: 80,
              left: 16,
              right: 80,
              child: MetadataOverlay(videoItem: widget.videoItem),
            ),
            
            // Engagement Sidebar (Bottom Right)
            Positioned(
              bottom: 80,
              right: 16,
              child: EngagementSidebar(videoItem: widget.videoItem),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildVideoPlayer() {
    return Consumer<VideoProvider>(
      builder: (context, provider, child) {
        final controller = provider.state.controllers[widget.videoItem.id];
        
        if (controller == null || !controller.value.isInitialized) {
          return Container(
            color: Colors.black,
            child: const Center(
              child: CircularProgressIndicator(
                valueColor: AlwaysStoppedAnimation<Color>(Colors.cyan),
              ),
            ),
          );
        }
        
        return VideoPlayer(controller);
      },
    );
  }
}
