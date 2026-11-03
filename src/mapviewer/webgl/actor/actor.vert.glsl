#version 300 es

#include "../shaders/includes/multi-draw.glsl";

#define TEXTURE_ANIM_UNIT (1.0f / 128.0f)

// TAU / 2048.0
#define RS_TO_RADIANS 0.00306796157

#define FOG_CORNER_ROUNDING 8.0

#define ACTOR_DATA_WIDTH 512

precision highp float;

layout(std140, column_major) uniform;

uniform highp isampler2D u_textureMaterials;

#include "../shaders/includes/scene-uniforms.glsl";

// First instance of this draw call in the actor data texture
uniform int u_instanceOffset;

// 2 texels per instance:
//  0: world x (tiles), world y (tiles, up is negative), world z (tiles), yaw (0-2047)
//  1: scale, flash (0-1), tint (0xRRGGBB, 0xFFFFFF = none), alpha
uniform highp sampler2D u_actorData;

layout(location = 0) in uvec3 a_vertex;

out vec4 v_color;
out vec2 v_texCoord;
flat out uint v_texId;
flat out float v_alphaCutOff;
out float v_fogAmount;
flat out vec4 v_interactId;

#include "../shaders/includes/branchless-logic.glsl";
#include "../shaders/includes/hsl-to-rgb.glsl";
#include "../shaders/includes/unpack-float.glsl";
#include "../shaders/includes/fog.glsl";

#include "../shaders/includes/material.glsl";

#include "../shaders/includes/vertex.glsl";

vec4 fetchActorData(int index) {
    return texelFetch(u_actorData, ivec2(index % ACTOR_DATA_WIDTH, index / ACTOR_DATA_WIDTH), 0);
}

mat4 rotationY( in float angle ) {
    return mat4(cos(angle),		0,		sin(angle),	0,
                         0,		1.0,			 0,	0,
                -sin(angle),	0,		cos(angle),	0,
                        0, 		0,				0,	1);
}

void main() {
    Vertex vertex = decodeVertex(a_vertex.x, a_vertex.y, a_vertex.z, u_brightness);

    Material material = getMaterial(vertex.textureId);
    vec2 textureAnimation = vec2(material.animU, material.animV);

    if (u_isNewTextureAnim > 0.5) {
        v_texCoord = vertex.texCoord + mod(mod(u_currentTime, 128.0) * textureAnimation / 64.0, 1.0);
    } else {
        v_texCoord = vertex.texCoord + (u_currentTime / 0.02) * textureAnimation * TEXTURE_ANIM_UNIT;
    }
    v_texId = vertex.textureId;
    v_alphaCutOff = material.alphaCutOff;

    // Without multi draw, a run of instances of one frame is one instanced draw
    int dataIndex = (DRAW_ID + gl_InstanceID + u_instanceOffset) * 2;
    vec4 data0 = fetchActorData(dataIndex);
    vec4 data1 = fetchActorData(dataIndex + 1);

    float scale = data1.x;
    float flash = data1.y;
    int tint = int(data1.z);
    float alpha = data1.w;

    vec3 tintColor = vec3(float((tint >> 16) & 0xFF), float((tint >> 8) & 0xFF), float(tint & 0xFF)) / 255.0;
    v_color = vertex.color;
    v_color.rgb = mix(v_color.rgb * tintColor, vec3(1.0), flash);
    v_color.a *= alpha;

    vec4 localPos = vec4(vertex.pos * scale, 1.0) * rotationY(data0.w * RS_TO_RADIANS);
    vec4 worldPos = vec4(localPos.xyz / 128.0 + data0.xyz, 1.0);

    float dist = -sdRoundedBox(
        vec2(worldPos.x - u_cameraPos.x, worldPos.z - u_cameraPos.y),
        vec2(u_renderDistance),
        FOG_CORNER_ROUNDING
    );
    float fogDepth = min(u_fogDepth, u_renderDistance);
    v_fogAmount = max(fogFactorLinear(dist, 0.0, fogDepth), playAreaFog(worldPos.xz));

    v_interactId = vec4(0.0);

    gl_Position = u_viewMatrix * worldPos;
    gl_Position.z += (float(vertex.priority) + 20.0) * 0.0007;
    gl_Position = u_projectionMatrix * gl_Position;
}
