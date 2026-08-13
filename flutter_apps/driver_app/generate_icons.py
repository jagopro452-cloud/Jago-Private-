from PIL import Image
import os

source_logo = r"d:\Jago-pro-V2\jago-main\jago-main\jago_app-main\flutter_apps\driver_app\assets\images\pilot_logo_white.png"

# Load the white logo
base_image = Image.open(source_logo).convert("RGBA")

# Create the sizes
sizes = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}

base_res_dir = r"d:\Jago-pro-V2\jago-main\jago-main\jago_app-main\flutter_apps\driver_app\android\app\src\main\res"

for folder, size in sizes.items():
    # Make a Blue background image, representing the brand
    icon = Image.new("RGBA", (size, size), (26, 80, 208, 255))
    
    # We want padding. Say the logo takes up 70% of the icon
    logo_size = int(size * 0.7)
    
    # Resize logo keeping aspect ratio
    aspect = base_image.width / base_image.height
    if aspect > 1:
        new_w = logo_size
        new_h = int(new_w / aspect)
    else:
        new_h = logo_size
        new_w = int(new_h * aspect)
        
    resized_logo = base_image.resize((new_w, new_h), Image.Resampling.LANCZOS)
    
    # Calculate offset to center it
    offset_x = (size - new_w) // 2
    offset_y = (size - new_h) // 2
    
    # Paste logo onto background
    icon.paste(resized_logo, (offset_x, offset_y), resized_logo)
    
    # Save as ic_launcher.png
    out_dir = os.path.join(base_res_dir, folder)
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "ic_launcher.png")
    icon.save(out_path, "PNG")
    print(f"Generated {out_path}")
