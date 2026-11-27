
// Original VIGIL trained Ridge model
// Training date: 2026-11-23

#pragma once

namespace VigilOccModel {

constexpr bool PROTOTYPE_ONLY = true;

constexpr float TRAIN_ROOM_VOLUME_M3 = 43.6079f;
constexpr float HISTORICAL_EMPTY_CO2_PPM = 511.0f;

constexpr float HISTORY_SECONDS = 60.0f;
constexpr float MIN_HISTORY_SECONDS = 50.0f;

constexpr float DELTA_SCALE_PPM = 100.0f;
constexpr float RATE_SCALE_PPM_PER_MIN = 10.0f;

constexpr float INTERCEPT = 3.176339566f;
constexpr float BETA_DELTA = 3.276897848f;
constexpr float BETA_RATE = 0.8872977638f;

constexpr float TRAIN_DELTA_MIN = -11.61538462f;
constexpr float TRAIN_DELTA_MAX = 391.1f;

constexpr float TRAIN_RATE_MIN = -138.7419172f;
constexpr float TRAIN_RATE_MAX = 28.51248862f;

constexpr float MAX_PEOPLE = 16.0f;

inline float estimate(float co2_delta_ppm,
                      float co2_rate_ppm_min) {

    const float raw =
        INTERCEPT
        + BETA_DELTA *
          (co2_delta_ppm / DELTA_SCALE_PPM)
        + BETA_RATE *
          (co2_rate_ppm_min / RATE_SCALE_PPM_PER_MIN);

    return raw < 0.0f ? 0.0f :
           (raw > MAX_PEOPLE ? MAX_PEOPLE : raw);
}

}
