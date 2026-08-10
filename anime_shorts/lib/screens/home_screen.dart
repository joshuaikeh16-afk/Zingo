import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/video_provider.dart';
import '../widgets/video_player_widget.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  String _selectedTab = 'For You';
  PageController? _pageController;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<VideoProvider>().initializeFeed();
    });
  }

  @override
  void dispose() {
    _pageController?.dispose();
    super.dispose();
  }

  void _onPageChanged(int index) {
    context.read<VideoProvider>().setCurrentIndex(index);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        children: [
          // Tab Toggle at Top
          Positioned(
            top: 40,
            left: 0,
            right: 0,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                _buildTabButton('Following'),
                const SizedBox(width: 24),
                _buildTabButton('For You'),
              ],
            ),
          ),
          
          // Video Feed
          Consumer<VideoProvider>(
            builder: (context, provider, child) {
              if (provider.state.isLoading) {
                return const Center(
                  child: CircularProgressIndicator(
                    valueColor: AlwaysStoppedAnimation<Color>(Colors.cyan),
                  ),
                );
              }

              if (provider.videoFeed.isEmpty) {
                return const Center(
                  child: Text(
                    'No videos yet',
                    style: TextStyle(color: Colors.white70, fontSize: 18),
                  ),
                );
              }

              return PageView.builder(
                scrollDirection: Axis.vertical,
                physics: const BouncingScrollPhysics(),
                itemCount: provider.videoFeed.length,
                controller: PageController(initialPage: provider.currentIndex),
                onPageChanged: _onPageChanged,
                itemBuilder: (context, index) {
                  final videoItem = provider.videoFeed[index];
                  return VideoPlayerWidget(
                    videoItem: videoItem,
                    isActive: index == provider.currentIndex,
                  );
                },
              );
            },
          ),
        ],
      ),
    );
  }

  Widget _buildTabButton(String text) {
    final isSelected = _selectedTab == text;
    return GestureDetector(
      onTap: () {
        setState(() {
          _selectedTab = text;
        });
      },
      child: Text(
        text,
        style: TextStyle(
          color: isSelected ? Colors.white : Colors.white54,
          fontSize: 18,
          fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
        ),
      ),
    );
  }
}
