idf_component_register(
    SRCS "rmp_mqtt.cpp"
    INCLUDE_DIRS "include"
    REQUIRES rmp_types rmp_ring mqtt json
)
