import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/video_item.dart';
import '../providers/video_provider.dart';

class EngagementSidebar extends StatelessWidget {
  final VideoItem videoItem;

  const EngagementSidebar({super.key, required this.videoItem});

  void _handleLike(BuildContext context) {
    context.read<VideoProvider>().toggleLike(videoItem.id);
  }

  void _handleBookmark(BuildContext context) {
    context.read<VideoProvider>().toggleBookmark(videoItem.id);
  }

  void _handleComments(BuildContext context) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (context) => CommentsBottomSheet(videoItem: videoItem),
    );
  }

  void _handleShare(BuildContext context) {
    // In a real app, use share_plus package
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Sharing ${videoItem.caption}'),
        backgroundColor: Colors.cyan,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        _buildActionButton(
          context: context,
          icon: Icons.favorite,
          count: videoItem.likeCount,
          isActive: videoItem.isLiked,
          activeColor: Colors.red,
          onTap: () => _handleLike(context),
        ),
        const SizedBox(height: 24),
        _buildActionButton(
          context: context,
          icon: Icons.comment_outlined,
          count: videoItem.commentCount,
          isActive: false,
          onTap: () => _handleComments(context),
        ),
        const SizedBox(height: 24),
        _buildActionButton(
          context: context,
          icon: videoItem.isBookmarked ? Icons.bookmark : Icons.bookmark_border,
          count: null,
          isActive: videoItem.isBookmarked,
          activeColor: Colors.amber,
          onTap: () => _handleBookmark(context),
        ),
        const SizedBox(height: 24),
        _buildActionButton(
          context: context,
          icon: Icons.share,
          count: videoItem.shareCount,
          isActive: false,
          onTap: () => _handleShare(context),
        ),
        const SizedBox(height: 16),
        _buildSpinningDisc(context),
      ],
    );
  }

  Widget _buildActionButton({
    required BuildContext context,
    required IconData icon,
    int? count,
    bool isActive = false,
    Color? activeColor,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Column(
        children: [
          Container(
            width: 50,
            height: 50,
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.1),
              shape: BoxShape.circle,
            ),
            child: Icon(
              icon,
              size: 30,
              color: isActive ? (activeColor ?? Colors.cyan) : Colors.white,
            ),
          ),
          if (count != null) ...[
            const SizedBox(height: 4),
            Text(
              _formatCount(count),
              style: TextStyle(
                color: Colors.white,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildSpinningDisc(BuildContext context) {
    return Container(
      width: 50,
      height: 50,
      decoration: BoxDecoration(
        color: Colors.black,
        shape: BoxShape.circle,
        border: Border.all(color: Colors.white24, width: 2),
      ),
      child: Stack(
        alignment: Alignment.center,
        children: [
          // Spinning animation could be added here with RotationTransition
          ClipOval(
            child: Image.network(
              videoItem.uploaderAvatarUrl,
              width: 46,
              height: 46,
              fit: BoxFit.cover,
              errorBuilder: (context, error, stackTrace) => Icon(
                Icons.music_note,
                color: Colors.cyan,
                size: 24,
              ),
            ),
          ),
        ],
      ),
    );
  }

  String _formatCount(int count) {
    if (count >= 1000000) {
      return '${(count / 1000000).toStringAsFixed(1)}M';
    } else if (count >= 1000) {
      return '${(count / 1000).toStringAsFixed(1)}K';
    }
    return count.toString();
  }
}

class CommentsBottomSheet extends StatelessWidget {
  final VideoItem videoItem;

  const CommentsBottomSheet({super.key, required this.videoItem});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: Color(0xFF1a1a2e),
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      padding: const EdgeInsets.all(20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                '${videoItem.commentCount} comments',
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                ),
              ),
              IconButton(
                onPressed: () => Navigator.pop(context),
                icon: const Icon(Icons.close, color: Colors.white),
              ),
            ],
          ),
          const SizedBox(height: 16),
          SizedBox(
            height: 300,
            child: ListView.builder(
              itemCount: 10,
              itemBuilder: (context, index) => _buildComment(index),
            ),
          ),
          const SizedBox(height: 16),
          _buildCommentInput(context),
        ],
      ),
    );
  }

  Widget _buildComment(int index) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          CircleAvatar(
            radius: 18,
            backgroundColor: Colors.cyan.withOpacity(0.3),
            child: Text(
              'U$index',
              style: const TextStyle(color: Colors.cyan, fontSize: 12),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'anime_fan_$index',
                  style: const TextStyle(
                    color: Colors.white70,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'This edit is amazing! 🔥 Love the transitions!',
                  style: const TextStyle(color: Colors.white, fontSize: 14),
                ),
              ],
            ),
          ),
          IconButton(
            onPressed: () {},
            icon: const Icon(Icons.favorite_border, size: 18, color: Colors.white54),
          ),
        ],
      ),
    );
  }

  Widget _buildCommentInput(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.1),
        borderRadius: BorderRadius.circular(25),
      ),
      child: Row(
        children: [
          Expanded(
            child: TextField(
              style: const TextStyle(color: Colors.white),
              decoration: InputDecoration(
                hintText: 'Add a comment...',
                hintStyle: TextStyle(color: Colors.white.withOpacity(0.5)),
                border: InputBorder.none,
              ),
            ),
          ),
          IconButton(
            onPressed: () {},
            icon: const Icon(Icons.send, color: Colors.cyan),
          ),
        ],
      ),
    );
  }
}
