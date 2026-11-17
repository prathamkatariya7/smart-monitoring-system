idf_component_register(
    SRCS "rmp_motor.cpp"
    INCLUDE_DIRS "include"
    REQUIRES rmp_types driver esp_timer
)
