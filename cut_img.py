# poe: name=Amazon-Image-Cutter

from fastapi_poe.types import SettingsResponse, ParameterControls, Section, TextField
from PIL import Image
from pillow_heif import register_heif_opener
import io
import re

register_heif_opener()

poe.update_settings(SettingsResponse(
    introduction_message=(
        "你好！我是 Amazon Image Cutter，帮你把产品合集图切割成亚马逊副图（默认 1600x1600，支持自定义尺寸）。\n\n"
        "**使用方法：**\n"
        "- 上传一张合集图（多产品拼在一起），自动切割并处理\n"
        "- 或直接上传多张独立产品图，跳过切割，直接扩展\n\n"
        "**可选参数（在消息中输入）：**\n"
        "- `排列: 3x2` — 指定切割排列（列x行），默认 3x2\n"
        "- `不切割` — AI 自动识别并逐张提取（适合间距不均匀的图片）\n"
        "- `不切割 8` — AI 提取模式，指定图片数量（默认 6）\n"
        "- `尺寸: 960x600` — 指定输出尺寸（宽x高），默认 1600x1600\n\n"
        "**示例：**\n"
        "- 上传图片，不输入文字 → 默认 3x2 切割，生成 6 张副图\n"
        "- 输入 `排列: 4x2` → 4列2行切割，生成 8 张副图\n"
        "- 输入 `不切割` → AI 提取 6 张副图\n"
        "- 输入 `不切割 8` → AI 提取 8 张副图\n"
        "- 输入 `尺寸: 960x600` → 输出 960x600 的图片\n"
        "- 输入 `排列: 3x2 尺寸: 800x800` → 3x2 切割，输出 800x800\n"
        "- 直接上传多张独立产品图 → 跳过切割，直接扩展每张图\n\n"
        "可通过消息输入框下方的设置图标更改 AI 模型（默认: Nano-Banana-2）。"
    ),
    enable_image_comprehension=True,
    parameter_controls=ParameterControls(
        sections=[
            Section(
                name="Settings",
                controls=[
                    TextField(
                        label="AI Model",
                        parameter_name="ai_model",
                        default_value="Nano-Banana-2",
                        placeholder="e.g. Nano-Banana-2, Nano-Banana-Pro",
                    ),
                ],
            )
        ]
    ),
))

SUPPORTED_RATIOS = [
    ("1:1", 1.0), ("2:3", 2/3), ("3:2", 3/2), ("3:4", 3/4), ("4:3", 4/3),
    ("4:5", 4/5), ("5:4", 5/4), ("9:16", 9/16), ("16:9", 16/9), ("21:9", 21/9),
]


class AmazonImageCutter:
    def _parse_input(self, user_text):
        """Parse user text to determine mode and parameters."""
        no_cut = False
        cols, rows = 3, 2
        target_w, target_h = 1600, 1600

        size_match = re.search(r"尺寸[:：]\s*(\d+)\s*[xX×]\s*(\d+)", user_text)
        if size_match:
            target_w = int(size_match.group(1))
            target_h = int(size_match.group(2))

        if "不切割" in user_text:
            no_cut = True
            match = re.search(r"不切割\s*(\d+)", user_text)
            total = int(match.group(1)) if match else 6
            return no_cut, cols, rows, total, target_w, target_h

        match = re.search(r"排列[:：]\s*(\d+)\s*[xX×]\s*(\d+)", user_text)
        if match:
            cols = int(match.group(1))
            rows = int(match.group(2))

        return no_cut, cols, rows, cols * rows, target_w, target_h

    def _get_closest_aspect_ratio(self, w, h):
        """Find the closest supported aspect ratio for the target dimensions."""
        target = w / h
        return min(SUPPORTED_RATIOS, key=lambda r: abs(r[1] - target))[0]

    def _get_prompt(self, aspect_ratio):
        """Generate the image expansion prompt for the given aspect ratio."""
        if aspect_ratio == "1:1":
            ratio_desc = "a 1:1 square"
        else:
            ratio_desc = f"a {aspect_ratio}"
        return (
            f"Expand this image into {ratio_desc} aspect ratio suitable for an Amazon product listing. "
            "Naturally extend the existing background to fill the new space seamlessly, "
            "avoiding any hard edges or visible seams. "
            "Keep the main product completely intact and clear. "
            "Ensure the final composition is balanced, whether the original background is "
            "a solid color, a gradient, or a real-world environment."
        )

    def _cut_image(self, image_bytes, cols, rows):
        """Cut image into grid pieces using PIL."""
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        w, h = img.size
        col_w = w // cols
        row_h = h // rows

        sub_images = []
        for row in range(rows):
            for col in range(cols):
                left = col * col_w
                top = row * row_h
                right = (col + 1) * col_w if col < cols - 1 else w
                bottom = (row + 1) * row_h if row < rows - 1 else h
                cropped = img.crop((left, top, right, bottom))
                buf = io.BytesIO()
                cropped.save(buf, format="PNG")
                sub_images.append(buf.getvalue())
        return sub_images

    def _extend_to_target(self, ai_model, idx, img_bytes, aspect_ratio):
        """Send a cropped sub-image to AI to extend to the target aspect ratio."""
        att = poe.Attachment(
            name=f"sub_{idx + 1}.png",
            contents=img_bytes,
            content_type="image/png",
        )
        response = poe.call(
            ai_model,
            poe.Message(text=self._get_prompt(aspect_ratio), attachments=[att]),
            parameters={"aspect_ratio": aspect_ratio, "image_only": True},
        )
        return response.last.attachments[0] if response.last.attachments else None

    def _extend_with_attachment(self, ai_model, idx, attachment, aspect_ratio):
        """Send an uploaded image attachment to AI to extend to the target aspect ratio."""
        att = poe.Attachment(
            name=f"img_{idx + 1}.png",
            url=attachment.url,
            content_type=attachment.content_type or "image/png",
        )
        response = poe.call(
            ai_model,
            poe.Message(text=self._get_prompt(aspect_ratio), attachments=[att]),
            parameters={"aspect_ratio": aspect_ratio, "image_only": True},
        )
        return response.last.attachments[0] if response.last.attachments else None

    def _extract_from_grid(self, ai_model, attachment, idx, total, aspect_ratio):
        """Ask AI to extract image #idx from the full grid and extend to the target aspect ratio."""
        response = poe.call(
            ai_model,
            poe.Message(
                text=(
                    f"This image contains {total} product images arranged in a grid. "
                    f"Please extract ONLY image #{idx + 1} "
                    f"(counting left-to-right, top-to-bottom) from this grid. "
                    f"Then {self._get_prompt(aspect_ratio)}"
                ),
                attachments=[attachment],
            ),
            parameters={"aspect_ratio": aspect_ratio, "image_only": True},
        )
        return response.last.attachments[0] if response.last.attachments else None

    def _resize_to_target(self, att, target_w, target_h):
        """Resize an image attachment to the specified dimensions."""
        result_bytes = att.get_contents()
        result_img = Image.open(io.BytesIO(result_bytes)).convert("RGB")
        result_img = result_img.resize((target_w, target_h), Image.LANCZOS)
        buf = io.BytesIO()
        result_img.save(buf, format="PNG")
        return buf.getvalue()

    def run(self):
        if not poe.query.attachments:
            raise poe.BotError("请上传图片（一张合集图或多张独立产品图）。")

        ai_model = poe.query.parameters.get("ai_model", "Nano-Banana-2")
        user_text = poe.query.text.strip()

        no_cut, cols, rows, total, target_w, target_h = self._parse_input(user_text)
        aspect_ratio = self._get_closest_aspect_ratio(target_w, target_h)

        # --- Multi-image mode: skip cutting, directly extend each image ---
        if len(poe.query.attachments) > 1:
            attachments = poe.query.attachments
            total = len(attachments)

            with poe.start_message() as msg:
                msg.write(
                    f"多图模式：{total} 张图，"
                    f"使用 **{ai_model}** 扩展为 {aspect_ratio}，输出 {target_w}x{target_h}...\n"
                )

            results = poe.parallel(
                *[
                    lambda i=i, att=att: self._extend_with_attachment(
                        ai_model, i, att, aspect_ratio
                    )
                    for i, att in enumerate(attachments)
                ],
                return_exceptions=True,
            )

            failed_indices = []
            with poe.start_message() as msg:
                for idx, result in enumerate(results):
                    if isinstance(result, Exception) or result is None:
                        failed_indices.append(idx + 1)
                        try:
                            fallback_bytes = self._resize_to_target(attachments[idx], target_w, target_h)
                            fallback_att = poe.Attachment(
                                name=f"amazon_{idx + 1}_raw.png",
                                contents=fallback_bytes,
                                content_type="image/png",
                                is_inline=True,
                            )
                            msg.add_attachment(fallback_att)
                            msg.write(f"Image {idx + 1}（AI 处理失败，输出原图缩放版本）\n\n")
                        except Exception:
                            msg.write(f"Image {idx + 1}：处理失败\n\n")
                    else:
                        resized_bytes = self._resize_to_target(result, target_w, target_h)
                        final_att = poe.Attachment(
                            name=f"amazon_{idx + 1}.png",
                            contents=resized_bytes,
                            content_type="image/png",
                            is_inline=True,
                        )
                        msg.add_attachment(final_att)
                        msg.write(f"Image {idx + 1}\n\n")

                if failed_indices:
                    msg.write(
                        f"---\n"
                        f"Image {', '.join(str(i) for i in failed_indices)} "
                        f"因 AI 安全策略被拦截，已输出原图缩放版本。\n"
                    )
            return

        # --- Single-image flow ---
        attachment = poe.query.attachments[0]

        image_bytes = attachment.get_contents()
        sub_images = None  # Only populated in cut mode for fallback

        if no_cut:
            # --- No-cut mode: AI extracts each image from the full grid ---
            with poe.start_message() as msg:
                msg.write(
                    f"AI 提取模式：从合集图中提取 {total} 张图，"
                    f"使用 **{ai_model}** 扩展为 {aspect_ratio}，输出 {target_w}x{target_h}...\n"
                )

            original_att = poe.Attachment(
                name="original.png",
                url=attachment.url,
                content_type=attachment.content_type or "image/png",
            )

            results = poe.parallel(
                *[
                    lambda i=i: self._extract_from_grid(
                        ai_model, original_att, i, total, aspect_ratio
                    )
                    for i in range(total)
                ],
                return_exceptions=True,
            )
        else:
            # --- Cut mode: PIL cuts the grid, AI extends each piece ---
            with poe.start_message() as msg:
                msg.write(
                    f"切割模式：{cols}列x{rows}行，共 {total} 张图，"
                    f"使用 **{ai_model}** 扩展为 {aspect_ratio}，输出 {target_w}x{target_h}...\n"
                )

            sub_images = self._cut_image(image_bytes, cols, rows)

            results = poe.parallel(
                *[
                    lambda i=i, b=b: self._extend_to_target(ai_model, i, b, aspect_ratio)
                    for i, b in enumerate(sub_images)
                ],
                return_exceptions=True,
            )

        # Process results and display
        failed_indices = []
        with poe.start_message() as msg:
            for idx, result in enumerate(results):
                if isinstance(result, Exception) or result is None:
                    # AI failed — fallback to raw cropped image (cut mode only)
                    failed_indices.append(idx + 1)
                    if sub_images and idx < len(sub_images):
                        fallback_att = poe.Attachment(
                            name=f"amazon_{idx + 1}_raw.png",
                            contents=sub_images[idx],
                            content_type="image/png",
                            is_inline=True,
                        )
                        msg.add_attachment(fallback_att)
                        msg.write(f"Image {idx + 1}（AI 处理失败，输出原始切割图）\n\n")
                    else:
                        msg.write(f"Image {idx + 1}：AI 处理失败\n\n")
                else:
                    resized_bytes = self._resize_to_target(result, target_w, target_h)
                    final_att = poe.Attachment(
                        name=f"amazon_{idx + 1}.png",
                        contents=resized_bytes,
                        content_type="image/png",
                        is_inline=True,
                    )
                    msg.add_attachment(final_att)
                    msg.write(f"Image {idx + 1}\n\n")

            if failed_indices:
                msg.write(
                    f"---\n"
                    f"Image {', '.join(str(i) for i in failed_indices)} "
                    f"因 AI 安全策略被拦截，已输出原始切割图。\n"
                )


if __name__ == "__main__":
    bot = AmazonImageCutter()
    bot.run()